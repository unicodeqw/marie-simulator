//! Машина MARIE на рівні команд — порт мікрокоду з `MarieSim.java`.

use std::fmt;

use crate::{format_word, op, parse_word, Radix, ADDR_MASK, MEM_SIZE};

#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize), serde(rename_all = "camelCase"))]
pub struct ProgramLine {
    pub address: u16,
    pub word: u16,
    pub label: String,
    pub mnemonic: String,
    pub operand: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize), serde(rename_all = "camelCase"))]
pub struct Program {
    pub lines: Vec<ProgramLine>,
}

impl Program {
    /// Адреса першого оператора — з неї стартує PC.
    pub fn start(&self) -> Option<u16> {
        self.lines.first().map(|l| l.address)
    }

    pub fn row_of(&self, address: u16) -> Option<usize> {
        self.lines.iter().rposition(|l| l.address == address)
    }
}

/// Регістри й пам'ять; спільні для симулятора й тракту даних.
#[derive(Clone, Debug)]
pub struct Cpu {
    pub mem: Vec<u16>,
    pub ac: u16,
    pub ir: u16,
    pub mbr: u16,
    pub pc: u16,
    pub mar: u16,
    pub input: u16,
    pub output: u16,
}

impl Default for Cpu {
    fn default() -> Cpu {
        Cpu { mem: vec![0; MEM_SIZE], ac: 0, ir: 0, mbr: 0, pc: 0, mar: 0, input: 0, output: 0 }
    }
}

impl Cpu {
    pub(crate) fn load(&mut self, program: &Program) {
        *self = Cpu::default();
        for line in &program.lines {
            self.mem[(line.address & ADDR_MASK) as usize] = line.word;
        }
        self.pc = program.start().unwrap_or(0);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub enum State {
    NoProgram,
    Ready,
    BlockedOnInput,
    /// Зупинка на точці зупинки.
    Paused,
    Halted,
    Fault,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub enum Fault {
    IllegalOpcode,
    IllegalCondition,
    IllegalInput,
}

impl fmt::Display for Fault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Fault::IllegalOpcode => "Illegal opcode",
            Fault::IllegalCondition => "Illegal conditional operand",
            Fault::IllegalInput => "Illegal numeric value in register",
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Snapshot {
    pub ac: u16,
    pub ir: u16,
    pub mbr: u16,
    pub pc: u16,
    pub mar: u16,
    pub input: u16,
    pub output: u16,
    pub state: State,
    pub fault: Option<Fault>,
    /// Рядок монітора програми з останньою вибраною командою.
    pub focus_row: Option<usize>,
    /// Комірка пам'яті, до якої зверталася остання команда.
    pub focus_cell: Option<u16>,
    pub breakpoints: Vec<bool>,
    pub executed: u64,
    pub output_len: usize,
}

// Команди, для яких вибірка одразу читає операнд у MBR.
fn operand_reqd(opcode: u16) -> bool {
    matches!(opcode, op::JNS | op::LOAD | op::STORE | op::ADD | op::SUBT | op::ADDI | op::JUMPI)
}

#[derive(Clone, Debug)]
pub struct Machine {
    cpu: Cpu,
    program: Program,
    state: State,
    fault: Option<Fault>,
    focus_row: Option<usize>,
    focus_cell: Option<u16>,
    breakpoints: Vec<bool>,
    executed: u64,
    // Значення разом із тим, чи ставити після нього перенос рядка.
    output_log: Vec<(u16, bool)>,
    pub input_radix: Radix,
    pub output_radix: Radix,
    pub output_linefeed: bool,
}

impl Default for Machine {
    fn default() -> Machine {
        Machine::new()
    }
}

impl Machine {
    pub fn new() -> Machine {
        Machine {
            cpu: Cpu::default(),
            program: Program::default(),
            state: State::NoProgram,
            fault: None,
            focus_row: None,
            focus_cell: None,
            breakpoints: Vec::new(),
            executed: 0,
            output_log: Vec::new(),
            input_radix: Radix::Ascii,
            output_radix: Radix::Ascii,
            output_linefeed: true,
        }
    }

    /// Повне скидання й завантаження програми. Порожня програма лишає
    /// машину без програми (оригінал на такій падав).
    pub fn load(&mut self, program: Program) -> bool {
        self.reset();
        if program.lines.is_empty() {
            return false;
        }
        self.cpu.load(&program);
        self.breakpoints = vec![false; program.lines.len()];
        self.program = program;
        self.focus_row = Some(0);
        self.state = State::Ready;
        true
    }

    /// Те саме, що `load` поточної програми, але точки зупинки лишаються.
    pub fn reload(&mut self) {
        let program = std::mem::take(&mut self.program);
        let breakpoints = std::mem::take(&mut self.breakpoints);
        if self.load(program) {
            self.breakpoints = breakpoints;
        }
    }

    /// Повертає PC на початок програми; пам'ять і решта регістрів не
    /// змінюються (оригінальний `restart`).
    pub fn restart(&mut self) {
        let Some(start) = self.program.start() else {
            return;
        };
        self.cpu.pc = start;
        self.fault = None;
        self.focus_row = Some(0);
        self.state = State::Ready;
    }

    pub fn reset(&mut self) {
        self.cpu = Cpu::default();
        self.program = Program::default();
        self.state = State::NoProgram;
        self.fault = None;
        self.focus_row = None;
        self.focus_cell = None;
        self.breakpoints.clear();
        self.executed = 0;
        self.output_log.clear();
    }

    fn fail(&mut self, fault: Fault) -> State {
        self.fault = Some(fault);
        self.state = State::Fault;
        self.state
    }

    /// Один цикл «вибірка — виконання». Точки зупинки тут не враховуються.
    pub fn step(&mut self) -> State {
        if !matches!(self.state, State::Ready | State::Paused) {
            return self.state;
        }
        self.state = State::Ready;
        let cpu = &mut self.cpu;

        cpu.mar = cpu.pc;
        cpu.ir = cpu.mem[cpu.mar as usize];
        if let Some(row) = self.program.row_of(cpu.pc) {
            self.focus_row = Some(row);
        }
        let opcode = cpu.ir >> 12;
        if opcode > op::JUMPI {
            return self.fail(Fault::IllegalOpcode);
        }
        if operand_reqd(opcode) {
            cpu.mar = cpu.ir & ADDR_MASK;
            cpu.mbr = cpu.mem[cpu.mar as usize];
            self.focus_cell = Some(cpu.mar);
        }
        cpu.pc = (cpu.pc + 1) & ADDR_MASK;
        self.executed += 1;

        match opcode {
            op::JNS => {
                cpu.mem[cpu.mar as usize] = cpu.pc;
                cpu.pc = (cpu.mar + 1) & ADDR_MASK;
            }
            op::LOAD => cpu.ac = cpu.mbr,
            op::STORE => {
                cpu.mbr = cpu.ac;
                cpu.mem[cpu.mar as usize] = cpu.mbr;
            }
            op::ADD => cpu.ac = cpu.ac.wrapping_add(cpu.mbr),
            op::SUBT => cpu.ac = cpu.ac.wrapping_sub(cpu.mbr),
            op::INPUT => self.state = State::BlockedOnInput,
            op::OUTPUT => {
                cpu.output = cpu.ac;
                let linefeed = self.output_linefeed || (cpu.output == 13 && self.output_radix == Radix::Ascii);
                self.output_log.push((cpu.output, linefeed));
            }
            op::HALT => self.state = State::Halted,
            op::SKIPCOND => {
                let ac = cpu.ac as i16;
                let skip = match (cpu.ir & 0x0C00) >> 10 {
                    0 => ac < 0,
                    1 => ac == 0,
                    2 => ac > 0,
                    _ => return self.fail(Fault::IllegalCondition),
                };
                if skip {
                    cpu.pc = (cpu.pc + 1) & ADDR_MASK;
                }
            }
            op::JUMP => cpu.pc = cpu.ir & ADDR_MASK,
            op::CLEAR => cpu.ac = 0,
            op::ADDI => {
                cpu.mar = cpu.mbr & ADDR_MASK;
                cpu.mbr = cpu.mem[cpu.mar as usize];
                cpu.ac = cpu.ac.wrapping_add(cpu.mbr);
            }
            op::JUMPI => cpu.pc = cpu.mbr & ADDR_MASK,
            _ => unreachable!(),
        }
        self.state
    }

    /// Виконує до `max` команд. Із `breakpoints` зупиняється *після* команди,
    /// позначеної точкою зупинки (так працює оригінальний Run to Breakpoint).
    pub fn run(&mut self, max: u32, breakpoints: bool) -> State {
        for _ in 0..max {
            let row = self.program.row_of(self.cpu.pc);
            if self.step() != State::Ready {
                break;
            }
            if breakpoints && row.is_some_and(|r| self.breakpoints[r]) {
                self.state = State::Paused;
                break;
            }
        }
        self.state
    }

    /// Завершує команду Input. Нечислове значення в режимах Hex/Dec — аварійна зупинка.
    pub fn provide_input(&mut self, text: &str) -> State {
        if self.state != State::BlockedOnInput {
            return self.state;
        }
        match parse_word(text, self.input_radix) {
            Some(value) => {
                self.cpu.input = value;
                self.cpu.ac = value;
                self.state = State::Ready;
                self.state
            }
            None => self.fail(Fault::IllegalInput),
        }
    }

    pub fn toggle_breakpoint(&mut self, row: usize) {
        if let Some(b) = self.breakpoints.get_mut(row) {
            *b = !*b;
        }
    }

    pub fn clear_breakpoints(&mut self) {
        self.breakpoints.fill(false);
    }

    pub fn clear_output(&mut self) {
        self.output_log.clear();
    }

    /// Увесь вивід у поточній системі числення.
    pub fn output_text(&self) -> String {
        let mut text = String::new();
        for &(value, linefeed) in &self.output_log {
            text.push_str(&format_word(value, self.output_radix));
            if linefeed {
                text.push('\n');
            }
        }
        text
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

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            ac: self.cpu.ac,
            ir: self.cpu.ir,
            mbr: self.cpu.mbr,
            pc: self.cpu.pc,
            mar: self.cpu.mar,
            input: self.cpu.input,
            output: self.cpu.output,
            state: self.state,
            fault: self.fault,
            focus_row: self.focus_row,
            focus_cell: self.focus_cell,
            breakpoints: self.breakpoints.clone(),
            executed: self.executed,
            output_len: self.output_log.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assemble;

    fn machine(source: &str) -> Machine {
        let asm = assemble(source);
        assert_eq!(asm.error_count, 0, "{:?}", asm.lines);
        let mut m = Machine::new();
        assert!(m.load(asm.program().unwrap()));
        m.output_radix = Radix::Dec;
        m.input_radix = Radix::Dec;
        m
    }

    fn run(m: &mut Machine) -> State {
        m.run(100_000, false)
    }

    #[test]
    fn load_sets_pc_to_first_statement() {
        let m = machine("ORG 100\nHalt\n");
        assert_eq!(m.cpu().pc, 0x100);
        assert_eq!(m.cpu().mem[0x100], 0x7000);
        assert_eq!(m.state(), State::Ready);
    }

    #[test]
    fn empty_program_is_not_loaded() {
        let mut m = Machine::new();
        assert!(!m.load(Program::default()));
        assert_eq!(m.state(), State::NoProgram);
        assert_eq!(m.step(), State::NoProgram);
    }

    #[test]
    fn lab_example_sum() {
        let mut m = machine("ORG 100\nLoad X\nAdd Y\nAdd Z\nStore R\nOutput\nHalt\nX, DEC 3\nY, DEC 5\nZ, DEC 15\nR, DEC 0\n");
        assert_eq!(run(&mut m), State::Halted);
        assert_eq!(m.cpu().ac, 23);
        assert_eq!(m.cpu().mem[0x109], 23);
        assert_eq!(m.output_text(), "23\n");
    }

    #[test]
    fn fetch_and_store_registers() {
        let mut m = machine("ORG 100\nLoad X\nStore Y\nHalt\nX, DEC 7\nY, DEC 0\n");
        m.step();
        let c = m.cpu();
        assert_eq!((c.ir, c.mar, c.mbr, c.ac, c.pc), (0x1103, 0x103, 7, 7, 0x101));
        m.step();
        let c = m.cpu();
        assert_eq!((c.ir, c.mar, c.mbr, c.pc, c.mem[0x104]), (0x2104, 0x104, 7, 0x102, 7));
        assert_eq!(m.snapshot().focus_cell, Some(0x104));
        assert_eq!(m.snapshot().focus_row, Some(1));
    }

    #[test]
    fn arithmetic_wraps() {
        let mut m = machine("Load A\nAdd B\nStore R\nSubt C\nHalt\nA, DEC 32767\nB, DEC 1\nC, HEX 8001\nR, DEC 0\n");
        run(&mut m);
        assert_eq!(m.cpu().mem[8], 0x8000);
        assert_eq!(m.cpu().ac, 0xFFFF);
    }

    #[test]
    fn skipcond_conditions() {
        // Друкує 1, якщо умову виконано (Output пропускає Jump).
        let source = |value: &str, cond: &str| {
            format!("Load V\nSkipcond {cond}\nJump End\nLoad One\nOutput\nEnd, Halt\nV, DEC {value}\nOne, DEC 1\n")
        };
        let taken = |value: &str, cond: &str| {
            let mut m = machine(&source(value, cond));
            run(&mut m);
            m.output_text() == "1\n"
        };
        assert!(taken("-5", "000") && !taken("0", "000") && !taken("5", "000"));
        assert!(!taken("-5", "400") && taken("0", "400") && !taken("5", "400"));
        assert!(!taken("-5", "800") && !taken("0", "800") && taken("5", "800"));
        // Молодші біти операнда ігноруються.
        assert!(taken("0", "4FF"));

        let mut m = machine(&source("0", "0C00"));
        assert_eq!(run(&mut m), State::Fault);
        assert_eq!(m.fault(), Some(Fault::IllegalCondition));
    }

    #[test]
    fn jns_keeps_ac_and_jumpi_returns() {
        let mut m = machine(
            "Load X\nJnS Sub\nOutput\nHalt\nX, DEC 20\nSub, HEX 0\nAdd X\nJumpI Sub\n",
        );
        assert_eq!(run(&mut m), State::Halted);
        // Адреса повернення — команда після JnS; AC дійшов до підпрограми незмінним.
        assert_eq!(m.cpu().mem[5], 2);
        assert_eq!(m.output_text(), "40\n");
    }

    #[test]
    fn addi_loop_sums_table() {
        let source = "\
ORG 100
Load Addr
Store Next
Load Num
Subt One
Store Ctr
Loop, Load Sum
AddI Next
Store Sum
Load Next
Add One
Store Next
Load Ctr
Subt One
Store Ctr
Skipcond 000
Jump Loop
Halt
Addr, Hex 117
Next, Hex 0
Num, Dec 5
Sum, Dec 0
Ctr, Hex 0
One, Dec 1
Dec 10
Dec 15
Dec 20
Dec 25
Dec 30
";
        let mut m = machine(source);
        assert_eq!(run(&mut m), State::Halted);
        assert_eq!(m.cpu().mem[0x114], 100);
    }

    #[test]
    fn input_blocks_until_value_arrives() {
        let mut m = machine("Input\nOutput\nHalt\n");
        assert_eq!(run(&mut m), State::BlockedOnInput);
        assert_eq!(m.step(), State::BlockedOnInput);
        assert_eq!(m.provide_input(" 42 "), State::Ready);
        assert_eq!(m.cpu().input, 42);
        assert_eq!(run(&mut m), State::Halted);
        assert_eq!(m.output_text(), "42\n");
    }

    #[test]
    fn input_modes() {
        let mut m = machine("Input\nHalt\n");
        m.input_radix = Radix::Ascii;
        m.step();
        m.provide_input("29");
        assert_eq!(m.cpu().ac, 0x32);

        m.restart();
        m.input_radix = Radix::Hex;
        m.step();
        m.provide_input("1f");
        assert_eq!(m.cpu().ac, 0x1F);

        m.restart();
        m.step();
        assert_eq!(m.provide_input("xyz"), State::Fault);
        assert_eq!(m.fault(), Some(Fault::IllegalInput));
    }

    #[test]
    fn output_modes_and_linefeeds() {
        let mut m = machine("Load A\nOutput\nLoad B\nOutput\nHalt\nA, DEC 72\nB, DEC 105\n");
        run(&mut m);
        assert_eq!(m.output_text(), "72\n105\n");
        m.output_radix = Radix::Hex;
        assert_eq!(m.output_text(), "0048\n0069\n");
        m.output_radix = Radix::Ascii;
        assert_eq!(m.output_text(), "H\ni\n");

        // Без переносів рядок розриває лише CR у режимі ASCII.
        let mut m = machine("Load A\nOutput\nLoad Cr\nOutput\nLoad A\nOutput\nHalt\nA, DEC 72\nCr, DEC 13\n");
        m.output_radix = Radix::Ascii;
        m.output_linefeed = false;
        run(&mut m);
        assert_eq!(m.output_text(), "H\r\nH");
        m.clear_output();
        assert_eq!(m.output_text(), "");
    }

    #[test]
    fn illegal_opcode_faults() {
        let mut m = machine("HEX D000\n");
        assert_eq!(m.step(), State::Fault);
        assert_eq!(m.fault(), Some(Fault::IllegalOpcode));
        assert_eq!(m.step(), State::Fault);
        assert_eq!(m.fault().unwrap().to_string(), "Illegal opcode");
    }

    #[test]
    fn pc_wraps_at_memory_end() {
        let mut m = machine("ORG FFF\nClear\n");
        m.step();
        assert_eq!(m.cpu().pc, 0);
    }

    #[test]
    fn breakpoint_pauses_after_marked_statement() {
        let mut m = machine("Clear\nAdd One\nAdd One\nHalt\nOne, DEC 1\n");
        m.toggle_breakpoint(1);
        assert_eq!(m.run(100, true), State::Paused);
        assert_eq!((m.cpu().pc, m.cpu().ac), (2, 1));
        assert_eq!(m.run(100, true), State::Halted);
        assert_eq!(m.cpu().ac, 2);

        m.restart();
        assert_eq!(m.run(100, false), State::Halted);
        m.restart();
        m.clear_breakpoints();
        assert_eq!(m.run(100, true), State::Halted);
    }

    #[test]
    fn restart_keeps_memory_reload_restores_it() {
        let mut m = machine("Load X\nAdd X\nStore X\nHalt\nX, DEC 2\n");
        m.toggle_breakpoint(0);
        run(&mut m);
        assert_eq!(m.cpu().mem[4], 4);
        m.restart();
        assert_eq!((m.cpu().pc, m.cpu().mem[4], m.cpu().ac), (0, 4, 4));
        assert_eq!(m.state(), State::Ready);
        m.reload();
        assert_eq!((m.cpu().mem[4], m.cpu().ac), (2, 0));
        assert_eq!(m.snapshot().breakpoints, [true, false, false, false, false]);
        m.reset();
        assert_eq!(m.state(), State::NoProgram);
        assert_eq!(m.cpu().mem[0], 0);
    }

    #[test]
    fn run_respects_instruction_limit() {
        let mut m = machine("Loop, Jump Loop\n");
        assert_eq!(m.run(1000, false), State::Ready);
        assert_eq!(m.snapshot().executed, 1000);
    }
}
