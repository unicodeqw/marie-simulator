//! Спільна основа симулятора й тракту даних: програма, регістри, пам'ять і стан.

use std::fmt;

use crate::{parse_word, Radix, ADDR_MASK, MEM_SIZE};

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Registers {
    pub ac: u16,
    pub ir: u16,
    pub mbr: u16,
    pub pc: u16,
    pub mar: u16,
    pub input: u16,
    pub output: u16,
}

#[derive(Clone, Debug)]
pub struct Cpu {
    pub mem: Vec<u16>,
    pub reg: Registers,
}

impl Default for Cpu {
    fn default() -> Cpu {
        Cpu { mem: vec![0; MEM_SIZE], reg: Registers::default() }
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

/// Те, що однаково працює в обох машинах: завантаження, рестарт, скидання,
/// аварійна зупинка і приймання вводу.
#[derive(Clone, Debug)]
pub(crate) struct Base {
    pub cpu: Cpu,
    pub program: Program,
    pub state: State,
    pub fault: Option<Fault>,
    /// Рядок монітора програми з останньою вибраною командою.
    pub focus_row: Option<usize>,
    pub input_radix: Radix,
}

impl Base {
    pub fn new(input_radix: Radix) -> Base {
        Base {
            cpu: Cpu::default(),
            program: Program::default(),
            state: State::NoProgram,
            fault: None,
            focus_row: None,
            input_radix,
        }
    }

    /// Повне скидання й завантаження. Порожня програма лишає машину без
    /// програми (оригінал на такій падав).
    pub fn load(&mut self, program: Program) -> bool {
        self.reset();
        let Some(start) = program.start() else {
            return false;
        };
        for line in &program.lines {
            self.cpu.mem[(line.address & ADDR_MASK) as usize] = line.word;
        }
        self.cpu.reg.pc = start;
        self.program = program;
        self.focus_row = Some(0);
        self.state = State::Ready;
        true
    }

    /// Повертає PC на початок програми; пам'ять і решта регістрів не
    /// змінюються (оригінальний `restart`).
    pub fn restart(&mut self) -> bool {
        let Some(start) = self.program.start() else {
            return false;
        };
        self.cpu.reg.pc = start;
        self.fault = None;
        self.focus_row = Some(0);
        self.state = State::Ready;
        true
    }

    pub fn reset(&mut self) {
        *self = Base::new(self.input_radix);
    }

    pub fn fail(&mut self, fault: Fault) {
        self.fault = Some(fault);
        self.state = State::Fault;
    }

    /// Переносить курсор монітора на команду, на яку вказує PC.
    pub fn focus_on_pc(&mut self) {
        if let Some(row) = self.program.row_of(self.cpu.reg.pc) {
            self.focus_row = Some(row);
        }
    }

    /// Значення для команди Input потрапляє в IN. Нечислове значення в
    /// режимах Hex/Dec — аварійна зупинка.
    pub fn accept_input(&mut self, text: &str) -> bool {
        match parse_word(text, self.input_radix) {
            Some(value) => {
                self.cpu.reg.input = value;
                self.state = State::Ready;
                true
            }
            None => {
                self.fail(Fault::IllegalInput);
                false
            }
        }
    }
}
