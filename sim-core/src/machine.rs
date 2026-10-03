//! Машина MARIE на рівні команд — порт мікрокоду з `MarieSim.java`.

use crate::base::{Base, Cpu, Fault, Program, Registers, State};
use crate::{format_word, op, Radix, ADDR_MASK};

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Snapshot {
    #[cfg_attr(feature = "serde", serde(flatten))]
    pub registers: Registers,
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
fn reads_operand(opcode: u16) -> bool {
    matches!(opcode, op::JNS | op::LOAD | op::STORE | op::ADD | op::SUBT | op::ADDI | op::JUMPI)
}

#[derive(Clone, Debug)]
pub struct Machine {
    base: Base,
    focus_cell: Option<u16>,
    breakpoints: Vec<bool>,
    executed: u64,
    // Значення разом із тим, чи ставити після нього перенос рядка.
    output_log: Vec<(u16, bool)>,
    output_radix: Radix,
    output_linefeed: bool,
}

impl Default for Machine {
    fn default() -> Machine {
        Machine::new()
    }
}

impl Machine {
    /// Ввід і вивід в оригіналі типово працюють у режимі ASCII.
    pub fn new() -> Machine {
        Machine {
            base: Base::new(Radix::Ascii),
            focus_cell: None,
            breakpoints: Vec::new(),
            executed: 0,
            output_log: Vec::new(),
            output_radix: Radix::Ascii,
            output_linefeed: true,
        }
    }

    pub fn load(&mut self, program: Program) -> bool {
        self.reset();
        let loaded = self.base.load(program);
        self.breakpoints = vec![false; self.base.program.lines.len()];
        loaded
    }

    /// Те саме, що `load` поточної програми, але точки зупинки лишаються.
    pub fn reload(&mut self) {
        let program = std::mem::take(&mut self.base.program);
        let breakpoints = std::mem::take(&mut self.breakpoints);
        if self.load(program) {
            self.breakpoints = breakpoints;
        }
    }

    pub fn restart(&mut self) {
        self.base.restart();
    }

    pub fn reset(&mut self) {
        self.base.reset();
        self.focus_cell = None;
        self.breakpoints.clear();
        self.executed = 0;
        self.output_log.clear();
    }

    /// Один цикл «вибірка — виконання». Точки зупинки тут не враховуються.
    pub fn step(&mut self) -> State {
        if !matches!(self.base.state, State::Ready | State::Paused) {
            return self.base.state;
        }
        self.base.state = State::Ready;
        self.base.focus_on_pc();
        let Cpu { mem, reg: r } = &mut self.base.cpu;

        r.mar = r.pc;
        r.ir = mem[r.mar as usize];
        let opcode = r.ir >> 12;
        if opcode > op::JUMPI {
            self.base.fail(Fault::IllegalOpcode);
            return self.base.state;
        }
        if reads_operand(opcode) {
            r.mar = r.ir & ADDR_MASK;
            r.mbr = mem[r.mar as usize];
            self.focus_cell = Some(r.mar);
        }
        r.pc = (r.pc + 1) & ADDR_MASK;
        self.executed += 1;

        match opcode {
            op::JNS => {
                mem[r.mar as usize] = r.pc;
                r.pc = (r.mar + 1) & ADDR_MASK;
            }
            op::LOAD => r.ac = r.mbr,
            op::STORE => {
                r.mbr = r.ac;
                mem[r.mar as usize] = r.mbr;
            }
            op::ADD => r.ac = r.ac.wrapping_add(r.mbr),
            op::SUBT => r.ac = r.ac.wrapping_sub(r.mbr),
            op::INPUT => self.base.state = State::BlockedOnInput,
            op::OUTPUT => {
                r.output = r.ac;
                let linefeed = self.output_linefeed || (r.output == 13 && self.output_radix == Radix::Ascii);
                self.output_log.push((r.output, linefeed));
            }
            op::HALT => self.base.state = State::Halted,
            op::SKIPCOND => {
                let ac = r.ac as i16;
                let skip = match (r.ir & 0x0C00) >> 10 {
                    0 => ac < 0,
                    1 => ac == 0,
                    2 => ac > 0,
                    _ => {
                        self.base.fail(Fault::IllegalCondition);
                        return self.base.state;
                    }
                };
                if skip {
                    r.pc = (r.pc + 1) & ADDR_MASK;
                }
            }
            op::JUMP => r.pc = r.ir & ADDR_MASK,
            op::CLEAR => r.ac = 0,
            op::ADDI => {
                r.mar = r.mbr & ADDR_MASK;
                r.mbr = mem[r.mar as usize];
                r.ac = r.ac.wrapping_add(r.mbr);
            }
            op::JUMPI => r.pc = r.mbr & ADDR_MASK,
            _ => unreachable!(),
        }
        self.base.state
    }

    /// Виконує до `max` команд. Із `breakpoints` зупиняється *після* команди,
    /// позначеної точкою зупинки (так працює оригінальний Run to Breakpoint).
    pub fn run(&mut self, max: u32, breakpoints: bool) -> State {
        for _ in 0..max {
            let row = self.base.program.row_of(self.base.cpu.reg.pc);
            if self.step() != State::Ready {
                break;
            }
            if breakpoints && row.is_some_and(|r| self.breakpoints[r]) {
                self.base.state = State::Paused;
                break;
            }
        }
        self.base.state
    }

    /// Завершує команду Input: значення потрапляє в IN та AC.
    pub fn provide_input(&mut self, text: &str) -> State {
        if self.base.state == State::BlockedOnInput && self.base.accept_input(text) {
            self.base.cpu.reg.ac = self.base.cpu.reg.input;
        }
        self.base.state
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

    /// Вивід у поточній системі числення, починаючи зі значення номер `from`.
    pub fn output_text(&self, from: usize) -> String {
        let mut text = String::new();
        for &(value, linefeed) in self.output_log.iter().skip(from) {
            text.push_str(&format_word(value, self.output_radix));
            if linefeed {
                text.push('\n');
            }
        }
        text
    }

    pub fn set_input_radix(&mut self, radix: Radix) {
        self.base.input_radix = radix;
    }

    pub fn input_radix(&self) -> Radix {
        self.base.input_radix
    }

    pub fn set_output_radix(&mut self, radix: Radix) {
        self.output_radix = radix;
    }

    pub fn output_radix(&self) -> Radix {
        self.output_radix
    }

    /// Чи ставити перенос рядка після кожного наступного значення.
    pub fn set_output_linefeed(&mut self, on: bool) {
        self.output_linefeed = on;
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

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            registers: self.base.cpu.reg,
            state: self.base.state,
            fault: self.base.fault,
            focus_row: self.base.focus_row,
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
        m.set_output_radix(Radix::Dec);
        m.set_input_radix(Radix::Dec);
        m
    }

    fn run(m: &mut Machine) -> State {
        m.run(100_000, false)
    }

    #[test]
    fn load_sets_pc_to_first_statement() {
        let m = machine("ORG 100\nHalt\n");
        assert_eq!(m.registers().pc, 0x100);
        assert_eq!(m.memory()[0x100], 0x7000);
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
        let mut m =
            machine("ORG 100\nLoad X\nAdd Y\nAdd Z\nStore R\nOutput\nHalt\nX, DEC 3\nY, DEC 5\nZ, DEC 15\nR, DEC 0\n");
        assert_eq!(run(&mut m), State::Halted);
        assert_eq!(m.registers().ac, 23);
        assert_eq!(m.memory()[0x109], 23);
        assert_eq!(m.output_text(0), "23\n");
    }

    #[test]
    fn fetch_and_store_registers() {
        let mut m = machine("ORG 100\nLoad X\nStore Y\nHalt\nX, DEC 7\nY, DEC 0\n");
        m.step();
        let r = m.registers();
        assert_eq!((r.ir, r.mar, r.mbr, r.ac, r.pc), (0x1103, 0x103, 7, 7, 0x101));
        m.step();
        let r = m.registers();
        assert_eq!((r.ir, r.mar, r.mbr, r.pc, m.memory()[0x104]), (0x2104, 0x104, 7, 0x102, 7));
        assert_eq!(m.snapshot().focus_cell, Some(0x104));
        assert_eq!(m.snapshot().focus_row, Some(1));
    }

    #[test]
    fn arithmetic_wraps() {
        let mut m = machine("Load A\nAdd B\nStore R\nSubt C\nHalt\nA, DEC 32767\nB, DEC 1\nC, HEX 8001\nR, DEC 0\n");
        run(&mut m);
        assert_eq!(m.memory()[8], 0x8000);
        assert_eq!(m.registers().ac, 0xFFFF);
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
            m.output_text(0) == "1\n"
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
        let mut m = machine("Load X\nJnS Sub\nOutput\nHalt\nX, DEC 20\nSub, HEX 0\nAdd X\nJumpI Sub\n");
        assert_eq!(run(&mut m), State::Halted);
        // Адреса повернення — команда після JnS; AC дійшов до підпрограми незмінним.
        assert_eq!(m.memory()[5], 2);
        assert_eq!(m.output_text(0), "40\n");
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
        assert_eq!(m.memory()[0x114], 100);
    }

    #[test]
    fn input_blocks_until_value_arrives() {
        let mut m = machine("Input\nOutput\nHalt\n");
        assert_eq!(run(&mut m), State::BlockedOnInput);
        assert_eq!(m.step(), State::BlockedOnInput);
        assert_eq!(m.provide_input(" 42 "), State::Ready);
        assert_eq!(m.registers().input, 42);
        assert_eq!(run(&mut m), State::Halted);
        assert_eq!(m.output_text(0), "42\n");
    }

    #[test]
    fn input_modes() {
        let mut m = machine("Input\nHalt\n");
        m.set_input_radix(Radix::Ascii);
        m.step();
        m.provide_input("29");
        assert_eq!(m.registers().ac, 0x32);

        m.restart();
        m.set_input_radix(Radix::Hex);
        m.step();
        m.provide_input("1f");
        assert_eq!(m.registers().ac, 0x1F);

        m.restart();
        m.step();
        assert_eq!(m.provide_input("xyz"), State::Fault);
        assert_eq!(m.fault(), Some(Fault::IllegalInput));
        // Поза очікуванням вводу значення ігнорується.
        assert_eq!(m.provide_input("1"), State::Fault);
    }

    #[test]
    fn output_modes_and_linefeeds() {
        let mut m = machine("Load A\nOutput\nLoad B\nOutput\nHalt\nA, DEC 72\nB, DEC 105\n");
        run(&mut m);
        assert_eq!(m.output_text(0), "72\n105\n");
        assert_eq!(m.output_text(1), "105\n");
        m.set_output_radix(Radix::Hex);
        assert_eq!(m.output_text(0), "0048\n0069\n");
        m.set_output_radix(Radix::Ascii);
        assert_eq!(m.output_text(0), "H\ni\n");

        // Без переносів рядок розриває лише CR у режимі ASCII.
        let mut m = machine("Load A\nOutput\nLoad Cr\nOutput\nLoad A\nOutput\nHalt\nA, DEC 72\nCr, DEC 13\n");
        m.set_output_radix(Radix::Ascii);
        m.set_output_linefeed(false);
        run(&mut m);
        assert_eq!(m.output_text(0), "H\r\nH");
        m.clear_output();
        assert_eq!(m.output_text(0), "");
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
        assert_eq!(m.registers().pc, 0);
    }

    #[test]
    fn breakpoint_pauses_after_marked_statement() {
        let mut m = machine("Clear\nAdd One\nAdd One\nHalt\nOne, DEC 1\n");
        m.toggle_breakpoint(1);
        assert_eq!(m.run(100, true), State::Paused);
        assert_eq!((m.registers().pc, m.registers().ac), (2, 1));
        assert_eq!(m.run(100, true), State::Halted);
        assert_eq!(m.registers().ac, 2);

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
        assert_eq!(m.memory()[4], 4);
        m.restart();
        assert_eq!((m.registers().pc, m.memory()[4], m.registers().ac), (0, 4, 4));
        assert_eq!(m.state(), State::Ready);
        m.reload();
        assert_eq!((m.memory()[4], m.registers().ac), (2, 0));
        assert_eq!(m.snapshot().breakpoints, [true, false, false, false, false]);
        m.reset();
        assert_eq!(m.state(), State::NoProgram);
        assert_eq!(m.memory()[0], 0);
    }

    #[test]
    fn run_respects_instruction_limit() {
        let mut m = machine("Loop, Jump Loop\n");
        assert_eq!(m.run(1000, false), State::Ready);
        assert_eq!(m.snapshot().executed, 1000);
    }
}
