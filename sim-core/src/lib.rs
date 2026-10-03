//! Ядро симулятора MARIE: асемблер, машина й модель тракту даних.
//! Порт MarieSim v1.3.01 (Null & Lobur); поведінку звірено з Java-сирцями.

mod assembler;
mod base;
mod datapath;
mod dump;
mod listing;
mod machine;
mod mex;

pub use assembler::{assemble, AsmError, Assembly, Code, CodeLine, Symbol};
pub use base::{Cpu, Fault, Program, ProgramLine, Registers, State};
pub use datapath::{DataPath, DataPathSnapshot, Frame, Part, Phase, Wait};
pub use dump::{core_dump, RegisterRadix};
pub use listing::{listing, symbol_map};
pub use machine::{Machine, Snapshot};
pub use mex::{read_mex, MexError, MexFile};

pub const MEM_SIZE: usize = 4096;
pub const ADDR_MASK: u16 = 0x0FFF;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Instruction {
    pub name: &'static str,
    /// Чи вимагає асемблер операнд після мнемоніки.
    pub takes_operand: bool,
}

const fn instruction(name: &'static str, takes_operand: bool) -> Instruction {
    Instruction { name, takes_operand }
}

/// Система команд; індекс у масиві — код операції.
pub const INSTRUCTIONS: [Instruction; 13] = [
    instruction("JnS", true),
    instruction("Load", true),
    instruction("Store", true),
    instruction("Add", true),
    instruction("Subt", true),
    instruction("Input", false),
    instruction("Output", false),
    instruction("Halt", false),
    instruction("Skipcond", true),
    instruction("Jump", true),
    instruction("Clear", false),
    instruction("AddI", true),
    instruction("JumpI", true),
];

pub const DIRECTIVES: [&str; 5] = ["ORG", "DEC", "OCT", "HEX", "END"];

pub mod op {
    pub const JNS: u16 = 0x0;
    pub const LOAD: u16 = 0x1;
    pub const STORE: u16 = 0x2;
    pub const ADD: u16 = 0x3;
    pub const SUBT: u16 = 0x4;
    pub const INPUT: u16 = 0x5;
    pub const OUTPUT: u16 = 0x6;
    pub const HALT: u16 = 0x7;
    pub const SKIPCOND: u16 = 0x8;
    pub const JUMP: u16 = 0x9;
    pub const CLEAR: u16 = 0xA;
    pub const ADDI: u16 = 0xB;
    pub const JUMPI: u16 = 0xC;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize), serde(rename_all = "camelCase"))]
pub enum Radix {
    #[default]
    Hex,
    Dec,
    Ascii,
}

/// Розбір введеного значення (оригінальний `stringToInt`): число обрізається
/// до 16 біт, у режимі ASCII береться код першого символу.
pub fn parse_word(text: &str, radix: Radix) -> Option<u16> {
    let s = text.trim();
    match radix {
        Radix::Dec => s.parse::<i32>().ok().map(|n| n as u16),
        Radix::Hex => i32::from_str_radix(s, 16).ok().map(|n| n as u16),
        Radix::Ascii => Some(s.chars().next().map_or(0, |c| (c as u32 % 128) as u16)),
    }
}

/// Значення 16-бітного слова для показу; у режимі ASCII нуль дає порожній рядок.
pub fn format_word(value: u16, radix: Radix) -> String {
    match radix {
        Radix::Hex => format!("{value:04X}"),
        Radix::Dec => (value as i16).to_string(),
        Radix::Ascii => match (value % 128) as u8 {
            0 => String::new(),
            c => (c as char).to_string(),
        },
    }
}

/// Те саме для 12-бітних PC і MAR: у HEX три цифри.
pub fn format_address(value: u16, radix: Radix) -> String {
    match radix {
        Radix::Hex => format!("{value:03X}"),
        _ => format_word(value, radix),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_word_modes() {
        assert_eq!(parse_word(" 29 ", Radix::Dec), Some(29));
        assert_eq!(parse_word("-1", Radix::Dec), Some(0xFFFF));
        assert_eq!(parse_word("70000", Radix::Dec), Some(70000u32 as u16));
        assert_eq!(parse_word("ff", Radix::Hex), Some(0xFF));
        assert_eq!(parse_word("29", Radix::Ascii), Some(0x32));
        assert_eq!(parse_word("", Radix::Ascii), Some(0));
        assert_eq!(parse_word("12x", Radix::Dec), None);
        assert_eq!(parse_word("", Radix::Hex), None);
    }

    #[test]
    fn format_word_modes() {
        assert_eq!(format_word(0x00C1, Radix::Ascii), "A");
        assert_eq!(format_word(0, Radix::Ascii), "");
        assert_eq!(format_word(0xFFFF, Radix::Dec), "-1");
        assert_eq!(format_word(0x1A, Radix::Hex), "001A");
        assert_eq!(format_address(0x1A, Radix::Hex), "01A");
        assert_eq!(format_address(0x1A, Radix::Dec), "26");
    }

    #[test]
    fn opcodes_index_the_instruction_table() {
        assert_eq!(INSTRUCTIONS[op::JNS as usize].name, "JnS");
        assert_eq!(INSTRUCTIONS[op::SKIPCOND as usize].name, "Skipcond");
        assert_eq!(INSTRUCTIONS[op::JUMPI as usize].name, "JumpI");
    }
}
