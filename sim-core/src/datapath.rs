//! Тракт даних на рівні мікрооперацій — за мотивами `MarieDPath.java`.
//!
//! Кожна мікрооперація розгортається в три кадри: підсвітка джерела,
//! приймача й керівних ліній → передача значення → усе гасне. Оригінал
//! робив те саме вручну для кожної команди (з кількома огріхами в порядку
//! перемальовування, яких тут немає).

use std::collections::VecDeque;

use self::Part::{Ac, In, Ir, Mar, Mbr, Memory, Out, Pc};
use crate::base::{Base, Cpu, Fault, Program, Registers, State};
use crate::{op, Radix, ADDR_MASK};

/// Скільки останніх рядків трасування зберігається.
const TRACE_LIMIT: usize = 5000;

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

const fn bit(part: Part) -> u8 {
    1 << part as u8
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
    active: u8,
    alu: bool,
    bus: bool,
    xfer: Xfer,
}

const NO_AUX: [bool; 4] = [false; 4];

/// Передача між регістрами через шину: коди на лініях запису й читання.
const fn bus(rtl: &'static str, write: Part, read: Part, xfer: Xfer) -> Micro {
    Micro {
        rtl,
        write: Some(write),
        read: Some(read),
        aux: NO_AUX,
        active: bit(write) | bit(read),
        alu: false,
        bus: true,
        xfer,
    }
}

/// Обмін із пам'яттю за адресою з MAR (лінія 7).
const fn memory(rtl: &'static str, write: Part, read: Part, xfer: Xfer) -> Micro {
    Micro { aux: [false, true, false, false], active: bit(write) | bit(read) | bit(Mar), ..bus(rtl, write, read, xfer) }
}

/// AC і MBR через ALU (лінії 8 і 9).
const fn alu(rtl: &'static str, xfer: Xfer) -> Micro {
    Micro {
        rtl,
        write: None,
        read: None,
        aux: [false, false, true, true],
        active: bit(Ac) | bit(Mbr),
        alu: true,
        bus: false,
        xfer,
    }
}

/// AC і MBR напряму (лінія 6).
const fn direct(rtl: &'static str, xfer: Xfer) -> Micro {
    Micro { aux: [true, false, false, false], alu: false, ..alu(rtl, xfer) }
}

/// Зміна одного регістра без джерела на шині.
const fn set(rtl: &'static str, part: Part, xfer: Xfer) -> Micro {
    Micro { rtl, write: Some(part), read: None, aux: NO_AUX, active: bit(part), alu: false, bus: false, xfer }
}

const MAR_PC: Micro = bus("MAR ← PC", Mar, Pc, Xfer::MarFromPc);
const IR_MEM: Micro = memory("IR ← M[MAR]", Ir, Memory, Xfer::IrFromMem);
// У вибірці PC збільшується без участі пристрою керування, як в оригіналі.
const PC_INC: Micro = Micro { write: None, ..SKIP };
const SKIP: Micro = set("PC ← PC + 1", Pc, Xfer::PcInc);
const MAR_IR: Micro = bus("MAR ← IR[11-0]", Mar, Ir, Xfer::MarFromIr);
const MBR_MEM: Micro = memory("MBR ← M[MAR]", Mbr, Memory, Xfer::MbrFromMem);
const MEM_MBR: Micro = memory("M[MAR] ← MBR", Memory, Mbr, Xfer::MemFromMbr);
const AC_PLUS_MBR: Micro = alu("AC ← AC + MBR", Xfer::AcAddMbr);
const AC_MINUS_MBR: Micro = alu("AC ← AC − MBR", Xfer::AcSubMbr);
const AC_IN: Micro = bus("AC ← IN", Ac, In, Xfer::AcFromIn);

// Кадр мікрооперації з підсвіткою; `xfer` — передача, яку він виконує.
fn lit(phase: Phase, m: &Micro, xfer: Option<Xfer>) -> Frame {
    Frame {
        phase,
        rtl: m.rtl.to_string(),
        write: m.write.map(|p| p as u8),
        read: m.read.map(|p| p as u8),
        aux: m.aux,
        active: m.active,
        alu: m.alu,
        control: m.write.is_some() || m.read.is_some(),
        bus: m.bus,
        wait: Wait::Brief,
        xfer,
    }
}

// Кадр без передачі, де світиться лише вказане.
fn show(rtl: &str, read: Part, alu: bool, wait: Wait) -> Frame {
    Frame {
        phase: Phase::Execute,
        rtl: rtl.to_string(),
        read: Some(read as u8),
        aux: [false, false, alu, false],
        active: bit(read),
        alu,
        control: true,
        wait,
        ..Frame::default()
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct DataPathSnapshot {
    #[cfg_attr(feature = "serde", serde(flatten))]
    pub registers: Registers,
    pub state: State,
    pub fault: Option<Fault>,
    pub frame: Frame,
    pub focus_row: Option<usize>,
    /// Скільки рядків трасування накопичено від рестарту.
    pub trace_len: usize,
}

#[derive(Clone, Debug)]
pub struct DataPath {
    base: Base,
    queue: VecDeque<Frame>,
    frame: Frame,
    // true, поки в черзі кадри вибірки; після них черга поповнюється виконанням.
    fetching: bool,
    trace: VecDeque<String>,
    trace_len: usize,
}

impl Default for DataPath {
    fn default() -> DataPath {
        DataPath::new()
    }
}

impl DataPath {
    /// В оригінальному MarieDPath ввід типово шістнадцятковий.
    pub fn new() -> DataPath {
        DataPath {
            base: Base::new(Radix::Hex),
            queue: VecDeque::new(),
            frame: Frame::default(),
            fetching: false,
            trace: VecDeque::new(),
            trace_len: 0,
        }
    }

    pub fn load(&mut self, program: Program) -> bool {
        self.clear_animation();
        self.base.load(program)
    }

    /// PC на початок, трасування з нуля; пам'ять і регістри не чіпаються.
    pub fn restart(&mut self) {
        if self.base.restart() {
            self.clear_animation();
        }
    }

    pub fn reset(&mut self) {
        self.base.reset();
        self.clear_animation();
    }

    fn clear_animation(&mut self) {
        self.queue.clear();
        self.frame = Frame::default();
        self.fetching = false;
        self.trace.clear();
        self.trace_len = 0;
    }

    // Три кадри мікрооперації: підсвітка, передача, темний кадр.
    fn push(&mut self, phase: Phase, m: &Micro) {
        self.queue.push_back(lit(phase, m, None));
        self.queue.push_back(lit(phase, m, Some(m.xfer)));
        self.push_dark(phase, m.rtl);
    }

    fn push_dark(&mut self, phase: Phase, rtl: &str) {
        self.queue.push_back(Frame { phase, rtl: rtl.to_string(), wait: Wait::Full, ..Frame::default() });
    }

    fn fail(&mut self, fault: Fault) {
        self.queue.clear();
        self.base.fail(fault);
    }

    fn trace_row(&mut self) {
        let r = &self.base.cpu.reg;
        let row = format!(
            " {:04X}  {:04X}  {:04X}  {:04X}  {:04X}  {:03X}  {:03X}",
            r.ir, r.output, r.input, r.ac, r.mbr, r.pc, r.mar
        );
        if self.trace.len() == TRACE_LIMIT {
            self.trace.pop_front();
        }
        self.trace.push_back(row);
        self.trace_len += 1;
    }

    fn apply(&mut self, xfer: Xfer) {
        let Cpu { mem, reg: r } = &mut self.base.cpu;
        let address = r.ir & ADDR_MASK;
        match xfer {
            // Запис у пам'ять і зміни стану рядка трасування не дають.
            Xfer::MemFromMbr => {
                mem[r.mar as usize] = r.mbr;
                return;
            }
            Xfer::AwaitInput => {
                self.base.state = State::BlockedOnInput;
                return;
            }
            Xfer::Halt => {
                self.base.state = State::Halted;
                return;
            }
            Xfer::MarFromPc => r.mar = r.pc,
            Xfer::IrFromMem => r.ir = mem[r.mar as usize],
            Xfer::PcInc => r.pc = (r.pc + 1) & ADDR_MASK,
            Xfer::MbrFromPc => r.mbr = r.pc,
            Xfer::MarFromIr => r.mar = address,
            Xfer::MbrFromIr => r.mbr = address,
            Xfer::AcOne => r.ac = 1,
            Xfer::AcAddMbr => r.ac = r.ac.wrapping_add(r.mbr),
            Xfer::AcSubMbr => r.ac = r.ac.wrapping_sub(r.mbr),
            Xfer::PcFromAc => r.pc = r.ac & ADDR_MASK,
            Xfer::MbrFromMem => r.mbr = mem[r.mar as usize],
            Xfer::AcFromMbr => r.ac = r.mbr,
            Xfer::MbrFromAc => r.mbr = r.ac,
            Xfer::AcFromIn => r.ac = r.input,
            Xfer::OutFromAc => r.output = r.ac,
            Xfer::PcFromIr => r.pc = address,
            Xfer::AcClear => r.ac = 0,
            Xfer::MarFromMbr => r.mar = r.mbr & ADDR_MASK,
            Xfer::PcFromMbr => r.pc = r.mbr & ADDR_MASK,
        }
        self.trace_row();
    }

    fn begin_fetch(&mut self) {
        self.base.focus_on_pc();
        self.fetching = true;
        self.push(Phase::Fetch, &MAR_PC);
        self.push(Phase::Fetch, &IR_MEM);
        self.push(Phase::Fetch, &PC_INC);
    }

    // Після вибірки: кадр декодування й мікрооперації виконання.
    fn decode(&mut self) {
        self.fetching = false;
        let ir = self.base.cpu.reg.ir;
        let opcode = ir >> 12;
        if opcode > op::JUMPI {
            return self.fail(Fault::IllegalOpcode);
        }
        self.queue.push_back(Frame { phase: Phase::Decode, ..show("Decode IR[15-12]", Ir, false, Wait::Brief) });

        let x = Phase::Execute;
        match opcode {
            op::JNS => {
                // RTN підручника: AC тут затирається (у MarieSim — ні).
                self.push(x, &bus("MBR ← PC", Mbr, Pc, Xfer::MbrFromPc));
                self.push(x, &MAR_IR);
                self.push(x, &MEM_MBR);
                self.push(x, &bus("MBR ← IR[11-0]", Mbr, Ir, Xfer::MbrFromIr));
                self.push(x, &set("AC ← 1", Ac, Xfer::AcOne));
                self.push(x, &AC_PLUS_MBR);
                self.push(x, &bus("PC ← AC", Pc, Ac, Xfer::PcFromAc));
            }
            op::LOAD => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, &direct("AC ← MBR", Xfer::AcFromMbr));
            }
            op::STORE => {
                self.push(x, &MAR_IR);
                self.push(x, &direct("MBR ← AC", Xfer::MbrFromAc));
                self.push(x, &MEM_MBR);
            }
            op::ADD | op::SUBT => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, if opcode == op::ADD { &AC_PLUS_MBR } else { &AC_MINUS_MBR });
            }
            // Перший кадр блокує машину; решту додає `provide_input`.
            op::INPUT => self.queue.push_back(lit(x, &AC_IN, Some(Xfer::AwaitInput))),
            op::OUTPUT => self.push(x, &bus("OUT ← AC", Out, Ac, Xfer::OutFromAc)),
            op::HALT => {
                self.queue.push_back(Frame { phase: x, rtl: "Halt".into(), xfer: Some(Xfer::Halt), ..Frame::default() })
            }
            op::SKIPCOND => self.skipcond(ir),
            op::JUMP => self.push(x, &bus("PC ← IR[11-0]", Pc, Ir, Xfer::PcFromIr)),
            op::CLEAR => self.push(x, &set("AC ← 0", Ac, Xfer::AcClear)),
            op::ADDI => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, &bus("MAR ← MBR", Mar, Mbr, Xfer::MarFromMbr));
                self.push(x, &MBR_MEM);
                self.push(x, &AC_PLUS_MBR);
            }
            op::JUMPI => {
                self.push(x, &MAR_IR);
                self.push(x, &MBR_MEM);
                self.push(x, &bus("PC ← MBR", Pc, Mbr, Xfer::PcFromMbr));
            }
            _ => unreachable!(),
        }
    }

    fn skipcond(&mut self, ir: u16) {
        let ac = self.base.cpu.reg.ac as i16;
        let (bits, question, skip) = match (ir & 0x0C00) >> 10 {
            0 => ("IR[11-10] = 00", "AC < 0?", ac < 0),
            1 => ("IR[11-10] = 01", "AC = 0?", ac == 0),
            2 => ("IR[11-10] = 10", "AC > 0?", ac > 0),
            _ => return self.fail(Fault::IllegalCondition),
        };
        self.queue.push_back(show(bits, Ir, false, Wait::Brief));
        self.queue.push_back(show(question, Ac, true, Wait::Full));
        if skip {
            self.push(Phase::Execute, &SKIP);
        } else {
            self.push_dark(Phase::Execute, &format!("{question} FALSE"));
        }
    }

    /// Показує наступний кадр. Повертає `true`, коли цим кадром команда завершилася.
    pub fn tick(&mut self) -> bool {
        if !matches!(self.base.state, State::Ready | State::Paused) {
            return false;
        }
        self.base.state = State::Ready;
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
        if !self.queue.is_empty() || self.base.state == State::BlockedOnInput {
            return false;
        }
        if self.fetching && self.base.state == State::Ready {
            self.decode();
            return self.base.state == State::Fault;
        }
        true
    }

    /// Завершує команду Input: значення потрапляє в IN, далі анімація AC ← IN.
    pub fn provide_input(&mut self, text: &str) -> State {
        if self.base.state != State::BlockedOnInput {
            return self.base.state;
        }
        if self.base.accept_input(text) {
            self.trace_row();
            self.queue.push_back(lit(Phase::Execute, &AC_IN, Some(Xfer::AcFromIn)));
            self.push_dark(Phase::Execute, AC_IN.rtl);
        } else {
            self.queue.clear();
        }
        self.base.state
    }

    pub fn set_input_radix(&mut self, radix: Radix) {
        self.base.input_radix = radix;
    }

    pub fn registers(&self) -> &Registers {
        &self.base.cpu.reg
    }

    pub fn memory(&self) -> &[u16] {
        &self.base.cpu.mem
    }

    pub fn program(&self) -> &Program {
        &self.base.program
    }

    pub fn state(&self) -> State {
        self.base.state
    }

    pub fn fault(&self) -> Option<Fault> {
        self.base.fault
    }

    /// Рядки трасування з номера `from` (від рестарту). Старіші за останні
    /// `TRACE_LIMIT` уже відкинуто.
    pub fn trace(&self, from: usize) -> impl Iterator<Item = &str> {
        let dropped = self.trace_len - self.trace.len();
        self.trace.iter().skip(from.saturating_sub(dropped)).map(String::as_str)
    }

    pub fn snapshot(&self) -> DataPathSnapshot {
        DataPathSnapshot {
            registers: self.base.cpu.reg,
            state: self.base.state,
            fault: self.base.fault,
            frame: self.frame.clone(),
            focus_row: self.base.focus_row,
            trace_len: self.trace_len,
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
        assert_eq!(d.registers().mar, 0);
        d.tick();
        assert_eq!(d.registers().mar, 0x100);
        d.tick();
        assert_eq!(d.snapshot().frame.wait, Wait::Full);
        assert_eq!(d.snapshot().frame.active, 0);

        d.restart();
        assert_eq!(instruction(&mut d), with_fetch(&["MAR ← IR[11-0]", "MBR ← M[MAR]", "AC ← MBR"]));
        let c = d.registers();
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
        assert_eq!(d.registers().pc, 0x00B);
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
        let c = d.registers();
        assert_eq!((d.memory()[4], c.pc, c.mbr, c.ac), (2, 5, 4, 5));
    }

    #[test]
    fn skipcond_shows_condition_and_result() {
        let mut d = datapath("Skipcond 400\nHalt\nSkipcond 800\nHalt\n");
        assert_eq!(instruction(&mut d), with_fetch(&["IR[11-10] = 01", "AC = 0?", "PC ← PC + 1"]));
        assert_eq!(d.registers().pc, 2);
        assert_eq!(instruction(&mut d), with_fetch(&["IR[11-10] = 10", "AC > 0?", "AC > 0? FALSE"]));
        assert_eq!(d.registers().pc, 3);

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
        assert_eq!(d.registers().input, 0x2A);
        // Крок після вводу завершує Input, але не чіпає наступну команду.
        instruction(&mut d);
        assert_eq!((d.registers().ac, d.registers().pc), (0x2A, 1));
        run(&mut d);
        assert_eq!((d.state(), d.registers().output), (State::Halted, 0x2A));

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
            d.trace(0).collect::<Vec<_>>(),
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
        assert_eq!(d.trace(8).count(), 2);
        assert_eq!(d.snapshot().trace_len, 10);
        d.restart();
        assert_eq!(d.trace(0).count(), 0);
        assert_eq!(d.snapshot().trace_len, 0);
        assert_eq!(d.registers().ac, 5);
    }

    #[test]
    fn trace_keeps_only_the_latest_rows() {
        let mut d = datapath("Loop, Jump Loop\n");
        while d.snapshot().trace_len < TRACE_LIMIT + 10 {
            d.tick();
        }
        let total = d.snapshot().trace_len;
        assert_eq!(d.trace(0).count(), TRACE_LIMIT);
        assert_eq!(d.trace(total - 3).count(), 3);
        assert_eq!(d.trace(total).count(), 0);
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
        assert_eq!(d.memory(), m.memory());
        assert_eq!(
            (d.registers().ac, d.registers().pc, d.registers().output),
            (m.registers().ac, m.registers().pc, m.registers().output)
        );
    }
}
