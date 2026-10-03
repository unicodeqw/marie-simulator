//! Двопрохідний асемблер — порт `Assembler.java`.

use std::collections::HashMap;
use std::fmt;

use crate::base::{Program, ProgramLine};
use crate::{ADDR_MASK, INSTRUCTIONS};

const MAX_ADDR: i32 = ADDR_MASK as i32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub enum AsmError {
    OrgNotFirst,
    LabelStartsWithDigit,
    DuplicateLabel,
    UnknownInstruction,
    MissingInstruction,
    MissingOperand,
    AddressOutOfRange,
    InvalidDecimal,
    InvalidOctal,
    InvalidHex,
    UndefinedOperand,
    TooManyLines,
}

impl fmt::Display for AsmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            AsmError::OrgNotFirst => "ORiGination directive must be first noncomment line of program ",
            AsmError::LabelStartsWithDigit => "A label cannot have 0..9 as its beginning character.",
            AsmError::DuplicateLabel => "Statement label must be unique.",
            AsmError::UnknownInstruction => "Instruction not recognized.",
            AsmError::MissingInstruction => "Missing instruction.",
            AsmError::MissingOperand => "Missing operand.",
            AsmError::AddressOutOfRange => "Hex address literal out of range 0 to 0FFF allowable.",
            AsmError::InvalidDecimal => "Invalid decimal value: -32768 to 32767 allowable.",
            AsmError::InvalidOctal => "Invalid octal value: 00000 to 177777 allowable.",
            AsmError::InvalidHex => "Invalid hexadecimal value: 0 to FFFF allowable.",
            AsmError::UndefinedOperand => "Operand undefined.",
            AsmError::TooManyLines => "Maximum line number exceeded.  Assembly halted.",
        })
    }
}

/// Слово, яке рядок кладе в пам'ять. `None` у полі — частину не вдалося
/// зібрати через помилку (у лістингу це `?` і `???`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Code {
    pub address: u16,
    /// Старша тетрада слова.
    pub opcode: Option<u8>,
    /// Молодші 12 біт.
    pub operand: Option<u16>,
}

impl Code {
    pub fn word(&self) -> Option<u16> {
        Some((self.opcode? as u16) << 12 | self.operand?)
    }
}

/// Один рядок вихідного коду після асемблювання.
#[derive(Clone, Debug, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct CodeLine {
    pub source: String,
    /// `None` — рядок не займає адреси: коментар, порожній, ORG або END.
    pub code: Option<Code>,
    pub label: Option<String>,
    /// Мнемоніка великими літерами, як у лістингу.
    pub mnemonic: Option<String>,
    /// Токен операнда: мітка як є, літерал — нормалізований.
    pub operand: Option<String>,
    pub comment: Option<String>,
    pub errors: Vec<AsmError>,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Symbol {
    pub name: String,
    pub address: u16,
    /// Адреси команд, що посилаються на символ.
    pub references: Vec<u16>,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Assembly {
    /// По одному запису на кожен прочитаний рядок (після END рядки не читаються).
    pub lines: Vec<CodeLine>,
    /// Відсортовано за іменем.
    pub symbols: Vec<Symbol>,
    pub error_count: usize,
}

impl Assembly {
    /// Програма для завантаження в машину; `None`, якщо є помилки.
    pub fn program(&self) -> Option<Program> {
        if self.error_count > 0 {
            return None;
        }
        let lines = self
            .lines
            .iter()
            .filter_map(|l| {
                let code = l.code?;
                Some(ProgramLine {
                    address: code.address,
                    word: code.word()?,
                    label: l.label.clone().unwrap_or_default(),
                    mnemonic: l.mnemonic.clone().unwrap_or_default(),
                    operand: l.operand.clone().unwrap_or_default(),
                })
            })
            .collect();
        Some(Program { lines })
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Directive {
    Org,
    Dec,
    Oct,
    Hex,
}

#[derive(Clone, Copy)]
enum Operation {
    Instruction { opcode: u8, takes_operand: bool },
    Constant(Directive),
    End,
}

fn operation(mnemonic: &str) -> Option<Operation> {
    if let Some(opcode) = INSTRUCTIONS.iter().position(|i| i.name.eq_ignore_ascii_case(mnemonic)) {
        return Some(Operation::Instruction {
            opcode: opcode as u8,
            takes_operand: INSTRUCTIONS[opcode].takes_operand,
        });
    }
    Some(match mnemonic {
        "ORG" => Operation::Constant(Directive::Org),
        "DEC" => Operation::Constant(Directive::Dec),
        "OCT" => Operation::Constant(Directive::Oct),
        "HEX" => Operation::Constant(Directive::Hex),
        "END" => Operation::End,
        _ => return None,
    })
}

// Адресний літерал мусить починатися з цифри — інакше це мітка (`ADD F00`).
fn is_literal(token: &str) -> bool {
    token.starts_with(|c: char| c.is_ascii_digit()) && token.chars().all(|c| c.is_ascii_hexdigit())
}

// Значення 32768..=65535 приймаються як ті самі 16 біт. Відхилення від
// оригіналу: менші за -32768 тут помилка (`validMarieValue` обгортав їх із
// неправильним знаком).
fn word_value(text: &str, radix: u32) -> Option<u16> {
    match i32::from_str_radix(text, radix).ok()? {
        n @ -32768..=65535 => Some(n as u16),
        _ => None,
    }
}

struct Entry {
    address: u16,
    references: Vec<u16>,
}

// Рядок після першого проходу: операнд-мітка ще чекає на адресу.
struct Parsed {
    line: CodeLine,
    symbol: Option<String>,
}

struct Assembler {
    // Адреса поточного оператора; -1 до першого рядка з кодом.
    line_number: i32,
    symbols: HashMap<String, Entry>,
    errors: Vec<AsmError>,
    error_count: usize,
    done: bool,
}

impl Assembler {
    fn error(&mut self, e: AsmError) {
        self.error_count += 1;
        self.errors.push(e);
    }

    // Повертає мітку (якщо вона придатна) і те, чи був перший токен міткою взагалі.
    fn statement_label(&mut self, token: &str) -> (Option<String>, bool) {
        let Some(i) = token.find(',') else {
            return (None, false);
        };
        // Усе після коми в цьому ж токені відкидається, як в оригіналі.
        let symbol = &token[..i];
        if symbol.is_empty() {
            return (None, true);
        }
        if symbol.starts_with(|c: char| c.is_ascii_digit()) {
            self.error(AsmError::LabelStartsWithDigit);
            return (None, true);
        }
        if self.symbols.contains_key(symbol) {
            self.error(AsmError::DuplicateLabel);
            return (None, true);
        }
        self.symbols.insert(symbol.to_string(), Entry { address: self.line_number as u16, references: Vec::new() });
        (Some(symbol.to_string()), true)
    }

    fn operation(&mut self, mnemonic: &str) -> Option<Operation> {
        match operation(mnemonic) {
            None => {
                self.error(AsmError::UnknownInstruction);
                None
            }
            Some(Operation::Constant(Directive::Org)) if self.line_number > 0 => {
                self.error(AsmError::OrgNotFirst);
                None
            }
            found => found,
        }
    }

    fn constant(&mut self, directive: Directive, text: &str) -> u16 {
        let (value, error) = match directive {
            Directive::Dec => (word_value(text, 10), AsmError::InvalidDecimal),
            Directive::Oct => (word_value(text, 8), AsmError::InvalidOctal),
            Directive::Hex => (word_value(text, 16), AsmError::InvalidHex),
            // Відхилення від оригіналу: ORG поза 000..FFF — помилка.
            Directive::Org => (word_value(text, 16).filter(|&v| v <= ADDR_MASK), AsmError::AddressOutOfRange),
        };
        value.unwrap_or_else(|| {
            self.error(error);
            0
        })
    }

    fn address(&mut self, text: &str) -> u16 {
        match word_value(text, 16) {
            Some(value) if value <= ADDR_MASK => value,
            Some(_) => {
                self.error(AsmError::AddressOutOfRange);
                0
            }
            None => {
                self.error(AsmError::InvalidHex);
                0
            }
        }
    }

    fn finish(&mut self, mut line: CodeLine, symbol: Option<String>) -> Parsed {
        line.errors = std::mem::take(&mut self.errors);
        Parsed { line, symbol }
    }

    fn parse_line(&mut self, input: &str) -> Parsed {
        let mut line = CodeLine { source: input.to_string(), ..CodeLine::default() };
        self.errors.clear();

        let code_len = input.find('/').unwrap_or(input.len());
        let mut tokens = input[..code_len].split([' ', '\t', '\r', '\x0C']).filter(|t| !t.is_empty());
        let Some(first) = tokens.next() else {
            line.comment = Some(input.to_string());
            return self.finish(line, None);
        };
        if code_len < input.len() {
            line.comment = Some(input[code_len..].to_string());
        }

        self.line_number += 1;
        if self.line_number > MAX_ADDR {
            self.error(AsmError::TooManyLines);
            self.done = true;
            return self.finish(line, None);
        }

        let (label, has_label) = self.statement_label(first);
        line.label = label;

        let mnemonic = if has_label { tokens.next() } else { Some(first) }.map(str::to_uppercase);
        let operation = match &mnemonic {
            Some(m) => self.operation(m),
            None => {
                self.error(AsmError::MissingInstruction);
                None
            }
        };
        // Нерозпізнана команда теж «чекає» операнд — так в оригіналі.
        let takes_operand = match operation {
            Some(Operation::Instruction { takes_operand, .. }) => takes_operand,
            Some(Operation::End) => false,
            Some(Operation::Constant(_)) => true,
            None => mnemonic.is_some(),
        };
        line.mnemonic = mnemonic;

        let mut opcode = match operation {
            Some(Operation::Instruction { opcode, .. }) => Some(opcode),
            _ => None,
        };
        let mut operand = Some(0);
        let mut symbol = None;

        if takes_operand {
            match (tokens.next(), operation) {
                (Some(token), Some(Operation::Constant(directive))) => {
                    let upper = token.to_uppercase();
                    let value = self.constant(directive, &upper);
                    line.operand = Some(upper);
                    // ORG із помилкою в рядку генерує слово, як константа (так в оригіналі).
                    if directive == Directive::Org && self.errors.is_empty() {
                        self.line_number = value as i32 - 1;
                        return self.finish(line, None);
                    }
                    opcode = Some((value >> 12) as u8);
                    operand = Some(value & ADDR_MASK);
                }
                (Some(token), _) if is_literal(token) => {
                    let value = self.address(token);
                    operand = Some(value);
                    line.operand = Some(format!("{value:03X}"));
                }
                (Some(token), _) => {
                    // Мітка розв'язується на другому проході.
                    operand = None;
                    symbol = Some(token.to_string());
                    line.operand = symbol.clone();
                }
                (None, _) => {
                    self.error(AsmError::MissingOperand);
                    operand = None;
                }
            }
        }

        if let Some(Operation::End) = operation {
            self.done = true;
        } else {
            line.code = Some(Code { address: self.line_number as u16, opcode, operand });
        }
        self.finish(line, symbol)
    }

    fn resolve(&mut self, parsed: Parsed) -> CodeLine {
        let Parsed { mut line, symbol } = parsed;
        let (Some(code), Some(symbol)) = (&mut line.code, symbol) else {
            return line;
        };
        match self.symbols.get_mut(&symbol) {
            Some(entry) => {
                entry.references.push(code.address);
                code.operand = Some(entry.address);
            }
            None => {
                line.errors.push(AsmError::UndefinedOperand);
                self.error_count += 1;
            }
        }
        line
    }
}

pub fn assemble(source: &str) -> Assembly {
    let mut asm =
        Assembler { line_number: -1, symbols: HashMap::new(), errors: Vec::new(), error_count: 0, done: false };

    let mut parsed = Vec::new();
    for input in source.lines() {
        parsed.push(asm.parse_line(input));
        if asm.done {
            break;
        }
    }
    let lines = parsed.into_iter().map(|p| asm.resolve(p)).collect();

    let mut symbols: Vec<Symbol> = asm
        .symbols
        .into_iter()
        .map(|(name, e)| Symbol { name, address: e.address, references: e.references })
        .collect();
    symbols.sort_by(|a, b| a.name.cmp(&b.name));

    Assembly { lines, symbols, error_count: asm.error_count }
}

#[cfg(test)]
mod tests {
    use super::*;

    // (адреса, слово) для рядків, що зібралися повністю.
    fn words(asm: &Assembly) -> Vec<(u16, u16)> {
        asm.lines.iter().filter_map(|l| l.code).filter_map(|c| Some((c.address, c.word()?))).collect()
    }

    fn errors(source: &str) -> Vec<AsmError> {
        assemble(source).lines.into_iter().flat_map(|l| l.errors).collect()
    }

    const COUNTDOWN: &str = "\
/ Countdown
        ORG 100
Loop,   Load Count      / AC <- counter
        Output
        Subt One
        Store Count
        Skipcond 400
        Jump Loop
        Halt
Count,  DEC 5
One,    DEC 1
";

    #[test]
    fn assembles_program_with_org_and_labels() {
        let asm = assemble(COUNTDOWN);
        assert_eq!(asm.error_count, 0);
        assert_eq!(
            words(&asm),
            [
                (0x100, 0x1107),
                (0x101, 0x6000),
                (0x102, 0x4108),
                (0x103, 0x2107),
                (0x104, 0x8400),
                (0x105, 0x9100),
                (0x106, 0x7000),
                (0x107, 0x0005),
                (0x108, 0x0001),
            ]
        );
        let names: Vec<_> = asm.symbols.iter().map(|s| (s.name.as_str(), s.address)).collect();
        assert_eq!(names, [("Count", 0x107), ("Loop", 0x100), ("One", 0x108)]);
        assert_eq!(asm.symbols[0].references, [0x100, 0x103]);

        let program = asm.program().unwrap();
        assert_eq!(
            program.lines[0],
            ProgramLine {
                address: 0x100,
                word: 0x1107,
                label: "Loop".into(),
                mnemonic: "LOAD".into(),
                operand: "Count".into(),
            }
        );
        assert_eq!(program.lines[1].operand, "");
    }

    #[test]
    fn starts_at_zero_without_org() {
        let asm = assemble("Load X\nHalt\nX, DEC 7\n");
        assert_eq!(words(&asm), [(0, 0x1002), (1, 0x7000), (2, 0x0007)]);
    }

    #[test]
    fn mnemonics_ignore_case_labels_do_not() {
        assert!(errors("x, dec 1\nLOAD x\nhalt\n").is_empty());
        assert_eq!(errors("x, DEC 1\nLoad X\n"), [AsmError::UndefinedOperand]);
    }

    #[test]
    fn address_literal_needs_leading_digit() {
        let asm = assemble("Add 0F00\nHalt\n");
        assert_eq!(asm.error_count, 0);
        assert_eq!(asm.lines[0].code.unwrap().operand, Some(0xF00));
        assert_eq!(asm.lines[0].operand.as_deref(), Some("F00"));
        // `F00` без нуля — це пошук мітки.
        assert_eq!(errors("Add F00\n"), [AsmError::UndefinedOperand]);
        assert_eq!(errors("Add 1000\n"), [AsmError::AddressOutOfRange]);
        assert_eq!(errors("Add 10000\n"), [AsmError::InvalidHex]);
    }

    #[test]
    fn constants() {
        let asm = assemble("DEC -1\nDEC 32767\nDEC -32768\nDEC 65535\nOCT 17\nHEX BABE\nHEX -1\n");
        assert_eq!(asm.error_count, 0);
        let got: Vec<_> = words(&asm).into_iter().map(|(_, w)| w).collect();
        assert_eq!(got, [0xFFFF, 0x7FFF, 0x8000, 0xFFFF, 0x000F, 0xBABE, 0xFFFF]);

        assert_eq!(errors("OCT 0900\n"), [AsmError::InvalidOctal]);
        assert_eq!(errors("DEC 65536\n"), [AsmError::InvalidDecimal]);
        assert_eq!(errors("DEC -32769\n"), [AsmError::InvalidDecimal]);
        assert_eq!(errors("HEX 1FFFF\n"), [AsmError::InvalidHex]);
        assert_eq!(errors("DEC x\n"), [AsmError::InvalidDecimal]);
    }

    #[test]
    fn org_rules() {
        assert_eq!(errors("Load 0\nORG 100\n"), [AsmError::OrgNotFirst]);
        assert_eq!(errors("ORG 1000\nHalt\n"), [AsmError::AddressOutOfRange]);
        // Коментар перед ORG не рахується.
        assert!(errors("/ c\n\nORG 0FF\nHalt\n").is_empty());
        let asm = assemble("ORG FFF\nHalt\n");
        assert_eq!(words(&asm), [(0xFFF, 0x7000)]);
        assert_eq!(asm.lines[0].code, None);
    }

    #[test]
    fn label_errors() {
        assert_eq!(errors("1x, Halt\n"), [AsmError::LabelStartsWithDigit]);
        assert_eq!(errors("A, Halt\nA, Halt\n"), [AsmError::DuplicateLabel]);
        assert_eq!(errors("A,\n"), [AsmError::MissingInstruction]);
        // Текст одразу після коми губиться, тож X стає «командою».
        assert_eq!(errors("Loop,Load X\n"), [AsmError::UnknownInstruction, AsmError::MissingOperand]);
    }

    #[test]
    fn operand_errors() {
        assert_eq!(errors("Load\n"), [AsmError::MissingOperand]);
        assert_eq!(errors("Foo\n"), [AsmError::UnknownInstruction, AsmError::MissingOperand]);
        assert_eq!(errors("Skipcond\n"), [AsmError::MissingOperand]);
        assert_eq!(errors("DEC\n"), [AsmError::MissingOperand]);
        // Зайві токени ігноруються.
        assert!(errors("Halt 5\nClear x y\n").is_empty());
    }

    #[test]
    fn end_stops_reading() {
        let asm = assemble("Halt\nEND\nFoo bar\n");
        assert_eq!(asm.error_count, 0);
        assert_eq!(asm.lines.len(), 2);
        assert_eq!(asm.lines[1].code, None);
        assert_eq!(asm.program().unwrap().lines.len(), 1);
    }

    #[test]
    fn comments_and_blank_lines_take_no_address() {
        let asm = assemble("/ only comment\n\n   \nHalt / stop\n");
        assert_eq!(asm.lines[0].comment.as_deref(), Some("/ only comment"));
        assert_eq!(asm.lines[3].comment.as_deref(), Some("/ stop"));
        assert_eq!(words(&asm), [(0, 0x7000)]);
    }

    #[test]
    fn errors_block_program() {
        let asm = assemble("Load X\n");
        assert_eq!(asm.error_count, 1);
        assert_eq!(asm.lines[0].code, Some(Code { address: 0, opcode: Some(1), operand: None }));
        assert!(asm.program().is_none());
    }

    #[test]
    fn too_many_lines() {
        let asm = assemble("ORG FFF\nHalt\nHalt\nHalt\n");
        assert_eq!(asm.lines.len(), 3);
        assert_eq!(asm.lines[2].errors, [AsmError::TooManyLines]);
    }
}
