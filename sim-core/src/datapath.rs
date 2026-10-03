//! Тракт даних на рівні мікрооперацій — за мотивами `MarieDPath.java`.
//!
//! Кожна мікрооперація розгортається в три кадри: підсвітка джерела,
//! приймача й керівних ліній → передача значення → усе гасне. Оригінал
//! робив те саме вручну для кожної команди (з кількома огріхами в порядку
//! перемальовування, яких тут немає).

use std::collections::VecDeque;

use crate::machine::{Cpu, Fault, Program, State};
use crate::{op, parse_word, Radix, ADDR_MASK};

/// Вузли тракту; числове значення — код на лініях вибору (як в оригіналі).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Part {
    Memory = 0,
    Mar = 1,
    Pc = 2,
    Mbr = 3,
    Ac = 4,
    In = 5,
    Out = 6,
    Ir = 7,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub enum Phase {
    #[default]
    Idle,
    Fetch,
    Decode,
    Execute,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub enum Wait {
    #[default]
    Brief,
    Full,
}

// Передача, яку кадр виконує в момент показу.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Xfer {
    MarFromPc,
    IrFromMem,
    PcInc,
    MbrFromPc,
    MarFromIr,
    MemFromMbr,
    MbrFromIr,
    AcOne,
    AcAddMbr,
    AcSubMbr,
    PcFromAc,
    MbrFromMem,
    AcFromMbr,
    MbrFromAc,
    AcFromIn,
    OutFromAc,
    PcFromIr,
    AcClear,
    MarFromMbr,
    PcFromMbr,
    AwaitInput,
    Halt,
}

/// Один кадр анімації: що світиться і скільки чекати після нього.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Frame {
    pub phase: Phase,
    pub rtl: String,
    /// Код приймача на лініях запису; `None` — лінії неактивні.
    pub write: Option<u8>,
    /// Код джерела на лініях читання.
    pub read: Option<u8>,
    /// Лінії 6..9: AC–MBR, MAR–пам'ять, AC–ALU, ALU–MBR.
    pub aux: [bool; 4],
    /// Бітова маска активних вузлів (біт = код `Part`).
    pub active: u8,
    pub alu: bool,
    pub control: bool,
    pub bus: bool,
    pub wait: Wait,
    #[cfg_attr(feature = "serde", serde(skip))]
    xfer: Option<Xfer>,
}

// Опис мікрооперації до розгортання в кадри.
struct Micro {
    rtl: &'static str,
    write: Option<Part>,
    read: Option<Part>,
    aux: [bool; 4],
    parts: &'static [Part],
    alu: bool,
    bus: bool,
    xfer: Xfer,
}

const NO_AUX: [bool; 4] = [false; 4];
const AC_MBR: [bool; 4] = [true, false, false, false];
const MAR_MEM: [bool; 4] = [false, true, false, false];
const VIA_ALU: [bool; 4] = [false, false, true, true];

use Part::*;

const fn bus(rtl: &'static str, write: Part, read: Part, parts: &'static [Part], xfer: Xfer) -> Micro {
    Micro { rtl, write: Some(write), read: Some(read), aux: NO_AUX, parts, alu: false, bus: true, xfer }
}

const fn mem(rtl: &'static str, write: Part, read: Part, parts: &'static [Part], xfer: Xfer) -> Micro {
    Micro { rtl, write: Some(write), read: Some(read), aux: MAR_MEM, parts, alu: false, bus: true, xfer }
}

const fn alu(rtl: &'static str, xfer: Xfer) -> Micro {
    Micro { rtl, write: None, read: None, aux: VIA_ALU, parts: &[Ac, Mbr], alu: true, bus: false, xfer }
}

const MAR_PC: Micro = bus("MAR ← PC", Mar, Pc, &[Pc, Mar], Xfer::MarFromPc);
const IR_MEM: Micro = mem("IR ← M[MAR]", Ir, Memory, &[Memory, Mar, Ir], Xfer::IrFromMem);
const PC_INC: Micro =
    Micro { rtl: "PC ← PC + 1", write: None, read: None, aux: NO_AUX, parts: &[Pc], alu: false, bus: false, xfer: Xfer::PcInc };
const MAR_IR: Micro = bus("MAR ← IR[11-0]", Mar, Ir, &[Ir, Mar], Xfer::MarFromIr);
const MBR_MEM: Micro = mem("MBR ← M[MAR]", Mbr, Memory, &[Memory, Mar, Mbr], Xfer::MbrFromMem);
const MEM_MBR: Micro = mem("M[MAR] ← MBR", Memory, Mbr, &[Memory, Mar, Mbr], Xfer::MemFromMbr);
const ADD: Micro = alu("AC ← AC + MBR", Xfer::AcAddMbr);
const SUB: Micro = alu("AC ← AC − MBR", Xfer::AcSubMbr);
const AC_MBR_DIRECT: Micro =
    Micro { rtl: "AC ← MBR", write: None, read: None, aux: AC_MBR, parts: &[Ac, Mbr], alu: false, bus: false, xfer: Xfer::AcFromMbr };
const MBR_AC_DIRECT: Micro =
    Micro { rtl: "MBR ← AC", write: None, read: None, aux: AC_MBR, parts: &[Ac, Mbr], alu: false, bus: false, xfer: Xfer::MbrFromAc };

fn mask(parts: &[Part]) -> u8 {
    parts.iter().fold(0, |m, &p| m | 1 << p as u8)
}

fn input_frame(xfer: Xfer) -> Frame {
    Frame {
        phase: Phase::Execute,
        rtl: "AC ← IN".into(),
        write: Some(Ac as u8),
        read: Some(In as u8),
        active: mask(&[In, Ac]),
        control: true,
        bus: true,
        xfer: Some(xfer),
        ..Frame::default()
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct DataPathSnapshot {
    pub ac: u16,
    pub ir: u16,
    pub mbr: u16,
    pub pc: u16,
    pub mar: u16,
    pub input: u16,
    pub output: u16,
    pub state: State,
    pub fault: Option<Fault>,
    pub frame: Frame,
    pub focus_row: Option<usize>,
    /// Скільки рядків трасування накопичено від рестарту.
    pub trace_len: usize,
}

#[derive(Clone, Debug)]
pub struct DataPath {
    cpu: Cpu,
    program: Program,
    state: State,
    fault: Option<Fault>,
    queue: VecDeque<Frame>,
    frame: Frame,
    // true, поки в черзі кадри вибірки; після них черга поповнюється виконанням.
    fetching: bool,
    focus_row: Option<usize>,
    trace: Vec<String>,
    pub input_radix: Radix,
}

impl Default for DataPath {
    fn default() -> DataPath {
        DataPath::new()
    }
}

impl DataPath {
    pub fn new() -> DataPath {
        DataPath {
            cpu: Cpu::default(),
            program: Program::default(),
            state: State::NoProgram,
            fault: None,
            queue: VecDeque::new(),
            frame: Frame::default(),
            fetching: false,
            focus_row: None,
            trace: Vec::new(),
            input_radix: Radix::Hex,
        }
    }

    pub fn load(&mut self, program: Program) -> bool {
        self.reset();
        if program.lines.is_empty() {
            return false;
        }
        self.cpu.load(&program);
        self.program = program;
        self.focus_row = Some(0);
        self.state = State::Ready;
        true
    }

    /// PC на початок, трасування з нуля; пам'ять і регістри не чіпаються.
    pub fn restart(&mut self) {
        let Some(start) = self.program.start() else {
            return;
        };
        self.cpu.pc = start;
        self.fault = None;
        self.queue.clear();
        self.frame = Frame::default();
        self.fetching = false;
        self.focus_row = Some(0);
        self.trace.clear();
        self.state = State::Ready;
    }

    pub fn reset(&mut self) {
        let input_radix = self.input_radix;
        *self = DataPath::new();
        self.input_radix = input_radix;
    }

    fn push(&mut self, phase: Phase, m: &Micro) {
        let lit = Frame {
            phase,
            rtl: m.rtl.to_string(),
            write: m.write.map(|p| p as u8),
            read: m.read.map(|p| p as u8),
            aux: m.aux,
            active: mask(m.parts),
            alu: m.alu,
            control: m.write.is_some() || m.read.is_some(),
            bus: m.bus,
            wait: Wait::Brief,
            xfer: None,
        };
        self.queue.push_back(lit.clone());
        self.queue.push_back(Frame { xfer: Some(m.xfer), ..lit });
        self.push_dark(phase, m.rtl);
    }

    fn push_dark(&mut self, phase: Phase, rtl: &str) {
        self.queue.push_back(Frame { phase, rtl: rtl.to_string(), wait: Wait::Full, ..Frame::default() });
    }

    fn fail(&mut self, fault: Fault) {
        self.queue.clear();
        self.fault = Some(fault);
        self.state = State::Fault;
    }

    fn trace_row(&mut self) {
        let c = &self.cpu;
        self.trace.push(format!(
            " {:04X}  {:04X}  {:04X}  {:04X}  {:04X}  {:03X}  {:03X}",
            c.ir, c.output, c.input, c.ac, c.mbr, c.pc, c.mar
        ));
    }

    fn apply(&mut self, xfer: Xfer) {
        let c = &mut self.cpu;
        let addr = c.ir & ADDR_MASK;
        match xfer {
            Xfer::MarFromPc => c.mar = c.pc,
            Xfer::IrFromMem => c.ir = c.mem[c.mar as usize],
            Xfer::PcInc => c.pc = (c.pc + 1) & ADDR_MASK,
            Xfer::MbrFromPc => c.mbr = c.pc,
            Xfer::MarFromIr => c.mar = addr,
            Xfer::MbrFromIr => c.mbr = addr,
            Xfer::AcOne => c.ac = 1,
            Xfer::AcAddMbr => c.ac = c.ac.wrapping_add(c.mbr),
            Xfer::AcSubMbr => c.ac = c.ac.wrapping_sub(c.mbr),
            Xfer::PcFromAc => c.pc = c.ac & ADDR_MASK,
            Xfer::MbrFromMem => c.mbr = c.mem[c.mar as usize],
            Xfer::AcFromMbr => c.ac = c.mbr,
            Xfer::MbrFromAc => c.mbr = c.ac,
            Xfer::AcFromIn => c.ac = c.input,
            Xfer::OutFromAc => c.output = c.ac,
            Xfer::PcFromIr => c.pc = addr,
            Xfer::AcClear => c.ac = 0,
            Xfer::MarFromMbr => c.mar = c.mbr & ADDR_MASK,
            Xfer::PcFromMbr => c.pc = c.mbr & ADDR_MASK,
            // Запис у пам'ять і зміни стану рядка трасування не дають.
            Xfer::MemFromMbr => return c.mem[c.mar as usize] = c.mbr,
            Xfer::AwaitInput => return self.state = State::BlockedOnInput,
            Xfer::Halt => return self.state = State::Halted,
        }
        self.trace_row();
    }

    fn begin_fetch(&mut self) {
        if let Some(row) = self.program.row_of(self.cpu.pc) {
            self.focus_row = Some(row);
        }
        self.fetching = true;
        self.push(Phase::Fetch, &MAR_PC);
        self.push(Phase::Fetch, &IR_MEM);
        self.push(Phase::Fetch, &PC_INC);
    }

    // Після вибірки: кадр декодування й мікрооперації виконання.
    fn decode(&mut self) {
        self.fetching = false;
        let ir = self.cpu.ir;
        let opcode = ir >> 12;
        if opcode > op::JUMPI {
            return self.fail(Fault::IllegalOpcode);
        }
        self.queue.push_back(Frame {
            phase: Phase::Decode,
            rtl: "Decode IR[15-12]".into(),
            read: Some(Ir as u8),
            active: mask(&[Ir]),
            control: true,
            ..Frame::default()
        });

        let x = Phase::Execute;
        match opcode {
            op::JNS => {
                // RTN підручника: AC тут затирається (у MarieSim — ні).
                self.push(x, &bus("MBR ← PC", Mbr, Pc, &[Pc, Mbr], Xfer::MbrFromPc));
                self.push(x, &MAR_IR);
                self.push(x, &MEM_MBR);
                self.push(x, &bus("MBR ← IR[11-0]", Mbr, Ir, &[Ir, Mbr], Xfer::MbrFromIr));
                self.push(x, &Micro {
                    rtl: "AC ← 1",
                    write: Some(Ac),
                    read: None,
                    aux: NO_AUX,
                    parts: &[Ac],
                    alu: false,
                    bus: false,
                    xfer: Xfer::AcOne,
                });
                self.push(x, &ADD);
                self.push(x, &bus("PC ← AC", Pc, Ac, &[Ac, Pc], Xfer::PcFromAc));
            }
            op::LOAD => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, &AC_MBR_DIRECT);
            }
            op::STORE => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_AC_DIRECT);
                self.push(x, &MEM_MBR);
            }
            op::ADD | op::SUBT => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, if opcode == op::ADD { &ADD } else { &SUB });
            }
            op::INPUT => {
                // Перший кадр блокує машину; решту додає `provide_input`.
                self.queue.push_back(input_frame(Xfer::AwaitInput));
            }
            op::OUTPUT => self.push(x, &bus("OUT ← AC", Out, Ac, &[Ac, Out], Xfer::OutFromAc)),
            op::HALT => self.queue.push_back(Frame {
                phase: x,
                rtl: "Halt".into(),
                wait: Wait::Brief,
                xfer: Some(Xfer::Halt),
                ..Frame::default()
            }),
            op::SKIPCOND => self.skipcond(ir),
            op::JUMP => self.push(x, &bus("PC ← IR[11-0]", Pc, Ir, &[Ir, Pc], Xfer::PcFromIr)),
            op::CLEAR => self.push(x, &Micro {
                rtl: "AC ← 0",
                write: Some(Ac),
                read: None,
                aux: NO_AUX,
                parts: &[Ac],
                alu: false,
                bus: false,
                xfer: Xfer::AcClear,
            }),
            op::ADDI => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, &bus("MAR ← MBR", Mar, Mbr, &[Mbr, Mar], Xfer::MarFromMbr));
                self.push(x, &MBR_MEM);
                self.push(x, &ADD);
            }
            op::JUMPI => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, &bus("PC ← MBR", Pc, Mbr, &[Mbr, Pc], Xfer::PcFromMbr));
            }
            _ => unreachable!(),
        }
    }

    fn skipcond(&mut self, ir: u16) {
        let ac = self.cpu.ac as i16;
        let (bits, question, skip) = match (ir & 0x0C00) >> 10 {
            0 => ("IR[11-10] = 00", "AC < 0?", ac < 0),
            1 => ("IR[11-10] = 01", "AC = 0?", ac == 0),
            2 => ("IR[11-10] = 10", "AC > 0?", ac > 0),
            _ => return self.fail(Fault::IllegalCondition),
        };
        let x = Phase::Execute;
        self.queue.push_back(Frame {
            phase: x,
            rtl: bits.into(),
            read: Some(Ir as u8),
            active: mask(&[Ir]),
            control: true,
            ..Frame::default()
        });
        self.queue.push_back(Frame {
            phase: x,
            rtl: question.into(),
            read: Some(Ac as u8),
            aux: [false, false, true, false],
            active: mask(&[Ac]),
            alu: true,
            control: true,
            wait: Wait::Full,
            ..Frame::default()
        });
        if skip {
            self.push(x, &Micro {
                rtl: "PC ← PC + 1",
                write: Some(Pc),
                read: None,
                aux: NO_AUX,
                parts: &[Pc],
                alu: false,
                bus: false,
                xfer: Xfer::PcInc,
            });
        } else {
            self.push_dark(x, &format!("{question} FALSE"));
        }
    }

    /// Показує наступний кадр. Повертає `true`, коли цим кадром команда завершилася.
    pub fn tick(&mut self) -> bool {
        if !matches!(self.state, State::Ready | State::Paused) {
            return false;
        }
        self.state = State::Ready;
        if self.queue.is_empty() {
            self.begin_fetch();
        }
        let Some(frame) = self.queue.pop_front() else {
            return false;
        };
        if let Some(xfer) = frame.xfer {
            self.apply(xfer);
        }
        self.frame = frame;
        if !self.queue.is_empty() || self.state == State::BlockedOnInput {
            return false;
        }
        if self.fetching && self.state == State::Ready {
            self.decode();
            return self.state == State::Fault;
        }
        true
    }

    /// Завершує команду Input: значення потрапляє в IN, далі анімація AC ← IN.
    pub fn provide_input(&mut self, text: &str) -> State {
        if self.state != State::BlockedOnInput {
            return self.state;
        }
        let Some(value) = parse_word(text, self.input_radix) else {
            self.fail(Fault::IllegalInput);
            return self.state;
        };
        self.cpu.input = value;
        self.trace_row();
        self.queue.push_back(input_frame(Xfer::AcFromIn));
        self.push_dark(Phase::Execute, "AC ← IN");
        self.state = State::Ready;
        self.state
    }

    pub fn cpu(&self) -> &Cpu {
        &self.cpu
    }

    pub fn program(&self) -> &Program {
        &self.program
    }

    pub fn state(&self) -> State {
        self.state
    }

    pub fn fault(&self) -> Option<Fault> {
        self.fault
    }

    /// Рядки трасування, починаючи з `from`.
    pub fn trace(&self, from: usize) -> &[String] {
        &self.trace[from.min(self.trace.len())..]
    }

    pub fn snapshot(&self) -> DataPathSnapshot {
        DataPathSnapshot {
            ac: self.cpu.ac,
            ir: self.cpu.ir,
            mbr: self.cpu.mbr,
            pc: self.cpu.pc,
            mar: self.cpu.mar,
            input: self.cpu.input,
            output: self.cpu.output,
            state: self.state,
            fault: self.fault,
            frame: self.frame.clone(),
            focus_row: self.focus_row,
            trace_len: self.trace.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{assemble, Machine};

    fn datapath(source: &str) -> DataPath {
        let asm = assemble(source);
        assert_eq!(asm.error_count, 0, "{:?}", asm.lines);
        let mut d = DataPath::new();
        assert!(d.load(asm.program().unwrap()));
        d
    }

    // Виконує одну команду й повертає RTL-рядки її кадрів без повторів.
    fn instruction(d: &mut DataPath) -> Vec<String> {
        let mut rtl: Vec<String> = Vec::new();
        for _ in 0..200 {
            let done = d.tick();
            let text = d.snapshot().frame.rtl;
            if rtl.last() != Some(&text) {
                rtl.push(text);
            }
            if done || d.state() != State::Ready {
                return rtl;
            }
        }
        panic!("instruction did not finish");
    }

    fn run(d: &mut DataPath) {
        for _ in 0..10_000 {
            if d.state() != State::Ready {
                return;
            }
            instruction(d);
        }
        panic!("program did not stop");
    }

    const FETCH: [&str; 4] = ["MAR ← PC", "IR ← M[MAR]", "PC ← PC + 1", "Decode IR[15-12]"];

    fn with_fetch(execute: &[&str]) -> Vec<String> {
        FETCH.iter().chain(execute).map(|s| s.to_string()).collect()
    }

    #[test]
    fn load_microoperations_and_control_lines() {
        let mut d = datapath("ORG 100\nLoad X\nHalt\nX, DEC 7\n");
        let first = {
            d.tick();
            d.snapshot().frame
        };
        assert_eq!(first.phase, Phase::Fetch);
        assert_eq!((first.write, first.read), (Some(1), Some(2)));
        assert_eq!(first.active, 0b0000_0110);
        assert!(first.bus && first.control);
        assert_eq!(first.wait, Wait::Brief);
        // Передача стається на другому кадрі мікрооперації.
        assert_eq!(d.cpu().mar, 0);
        d.tick();
        assert_eq!(d.cpu().mar, 0x100);
        d.tick();
        assert_eq!(d.snapshot().frame.wait, Wait::Full);
        assert_eq!(d.snapshot().frame.active, 0);

        d.restart();
        assert_eq!(instruction(&mut d), with_fetch(&["MAR ← IR[11-0]", "MBR ← M[MAR]", "AC ← MBR"]));
        let c = d.cpu();
        assert_eq!((c.ir, c.mar, c.mbr, c.ac, c.pc), (0x1102, 0x102, 7, 7, 0x101));
    }

    #[test]
    fn memory_read_uses_line_seven() {
        let mut d = datapath("Load X\nHalt\nX, DEC 7\n");
        for _ in 0..4 {
            d.tick();
        }
        let f = d.snapshot().frame;
        assert_eq!(f.rtl, "IR ← M[MAR]");
        assert_eq!((f.write, f.read), (Some(7), Some(0)));
        assert_eq!(f.aux, [false, true, false, false]);
        assert_eq!(f.active, 0b1000_0011);
    }

    #[test]
    fn rtl_per_instruction() {
        let mut d = datapath(
            "Store T\nAdd T\nSubt T\nAddI P\nOutput\nClear\nJump Next\nNext, JumpI V\nT, DEC 0\nP, HEX 008\nV, HEX 00B\nHalt\n",
        );
        let m = "MAR ← IR[11-0]";
        let r = "MBR ← M[MAR]";
        assert_eq!(instruction(&mut d), with_fetch(&[m, "MBR ← AC", "M[MAR] ← MBR"]));
        assert_eq!(instruction(&mut d), with_fetch(&[m, r, "AC ← AC + MBR"]));
        assert_eq!(instruction(&mut d), with_fetch(&[m, r, "AC ← AC − MBR"]));
        assert_eq!(instruction(&mut d), with_fetch(&[m, r, "MAR ← MBR", r, "AC ← AC + MBR"]));
        assert_eq!(instruction(&mut d), with_fetch(&["OUT ← AC"]));
        assert_eq!(instruction(&mut d), with_fetch(&["AC ← 0"]));
        assert_eq!(instruction(&mut d), with_fetch(&["PC ← IR[11-0]"]));
        assert_eq!(instruction(&mut d), with_fetch(&[m, r, "PC ← MBR"]));
        assert_eq!(d.cpu().pc, 0x00B);
        assert_eq!(instruction(&mut d), with_fetch(&["Halt"]));
        assert_eq!(d.state(), State::Halted);
    }

    #[test]
    fn jns_follows_textbook_rtn() {
        let mut d = datapath("Load X\nJnS Sub\nHalt\nX, DEC 20\nSub, HEX 0\nHalt\n");
        instruction(&mut d);
        assert_eq!(
            instruction(&mut d),
            with_fetch(&[
                "MBR ← PC",
                "MAR ← IR[11-0]",
                "M[MAR] ← MBR",
                "MBR ← IR[11-0]",
                "AC ← 1",
                "AC ← AC + MBR",
                "PC ← AC",
            ])
        );
        let c = d.cpu();
        assert_eq!((c.mem[4], c.pc, c.mbr, c.ac), (2, 5, 4, 5));
    }

    #[test]
    fn skipcond_shows_condition_and_result() {
        let mut d = datapath("Skipcond 400\nHalt\nSkipcond 800\nHalt\n");
        assert_eq!(instruction(&mut d), with_fetch(&["IR[11-10] = 01", "AC = 0?", "PC ← PC + 1"]));
        assert_eq!(d.cpu().pc, 2);
        assert_eq!(instruction(&mut d), with_fetch(&["IR[11-10] = 10", "AC > 0?", "AC > 0? FALSE"]));
        assert_eq!(d.cpu().pc, 3);

        let mut d = datapath("Skipcond 0C00\n");
        instruction(&mut d);
        assert_eq!((d.state(), d.fault()), (State::Fault, Some(Fault::IllegalCondition)));
    }

    #[test]
    fn illegal_opcode_faults_after_fetch() {
        let mut d = datapath("HEX F000\n");
        let rtl = instruction(&mut d);
        assert_eq!(rtl, &FETCH[..3]);
        assert_eq!((d.state(), d.fault()), (State::Fault, Some(Fault::IllegalOpcode)));
        assert!(!d.tick());
    }

    #[test]
    fn input_blocks_and_resumes_within_instruction() {
        let mut d = datapath("Input\nOutput\nHalt\n");
        assert_eq!(instruction(&mut d), with_fetch(&["AC ← IN"]));
        assert_eq!(d.state(), State::BlockedOnInput);
        assert!(!d.tick());
        assert_eq!(d.provide_input("2A"), State::Ready);
        assert_eq!(d.cpu().input, 0x2A);
        // Крок після вводу завершує Input, але не чіпає наступну команду.
        instruction(&mut d);
        assert_eq!((d.cpu().ac, d.cpu().pc), (0x2A, 1));
        run(&mut d);
        assert_eq!((d.state(), d.cpu().output), (State::Halted, 0x2A));

        d.restart();
        instruction(&mut d);
        assert_eq!(d.provide_input("zz"), State::Fault);
    }

    #[test]
    fn trace_has_a_row_per_register_write() {
        let mut d = datapath("ORG 100\nLoad X\nOutput\nHalt\nX, DEC 5\n");
        instruction(&mut d);
        instruction(&mut d);
        assert_eq!(
            d.trace(0),
            [
                " 0000  0000  0000  0000  0000  100  100",
                " 1103  0000  0000  0000  0000  100  100",
                " 1103  0000  0000  0000  0000  101  100",
                " 1103  0000  0000  0000  0000  101  103",
                " 1103  0000  0000  0000  0005  101  103",
                " 1103  0000  0000  0005  0005  101  103",
                " 1103  0000  0000  0005  0005  101  101",
                " 6000  0000  0000  0005  0005  101  101",
                " 6000  0000  0000  0005  0005  102  101",
                " 6000  0005  0000  0005  0005  102  101",
            ]
        );
        assert_eq!(d.trace(8).len(), 2);
        assert_eq!(d.snapshot().trace_len, 10);
        d.restart();
        assert!(d.trace(0).is_empty());
        assert_eq!(d.cpu().ac, 5);
    }

    #[test]
    fn agrees_with_machine_on_programs_without_jns() {
        let source = "\
ORG 100
Loop, Load Count
Output
Subt One
Store Count
Skipcond 400
Jump Loop
Halt
Count, DEC 5
One, DEC 1
";
        let mut d = datapath(source);
        run(&mut d);
        let mut m = Machine::new();
        m.load(assemble(source).program().unwrap());
        m.run(10_000, false);
        assert_eq!(d.state(), State::Halted);
        assert_eq!(d.cpu().mem, m.cpu().mem);
        assert_eq!((d.cpu().ac, d.cpu().pc, d.cpu().output), (m.cpu().ac, m.cpu().pc, m.cpu().output));
    }
}
