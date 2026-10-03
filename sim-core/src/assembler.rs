//! Двопрохідний асемблер — порт `Assembler.java`.

use std::collections::HashMap;
use std::fmt;

use crate::machine::{Program, ProgramLine};
use crate::{hex3, hex4};

const MAX_ADDR: i32 = 4095;
// Коди директив, як в оригіналі; опкоди команд — 0..=12.
const DEC: i32 = -1;
const OCT: i32 = -2;
const HEX: i32 = -3;
const ORG: i32 = -4;
const END: i32 = -5;
const NOT_FOUND: i32 = i32::MIN;

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

/// Один рядок вихідного коду після асемблювання (оригінальний
/// `AssembledCodeLine`). Поля-рядки зберігають оригінальні заповнювачі:
/// `line_no` із пробілів означає рядок без коду.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct CodeLine {
    pub line_no: String,
    pub hex_code: String,
    pub operand: String,
    pub source: String,
    pub label: String,
    pub mnemonic: String,
    pub operand_token: String,
    pub comment: String,
    pub errors: Vec<AsmError>,
}

impl CodeLine {
    fn blank(source: &str) -> CodeLine {
        CodeLine {
            line_no: "     ".into(),
            hex_code: " ".into(),
            operand: " ".into(),
            source: source.into(),
            label: " ".into(),
            mnemonic: " ".into(),
            operand_token: " ".into(),
            comment: " ".into(),
            errors: Vec::new(),
        }
    }

    pub fn has_code(&self) -> bool {
        !self.line_no.starts_with(' ')
    }
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Symbol {
    pub name: String,
    pub address: String,
    pub references: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "camelCase"))]
pub struct Assembly {
    /// По одному запису на кожен прочитаний рядок (після END рядки не читаються).
    pub lines: Vec<CodeLine>,
    /// Відсортовано за іменем.
    pub symbols: Vec<Symbol>,
    pub error_count: usize,
    /// Ширина колонки мітки в лістингу: 6..=24.
    pub symbol_width: usize,
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
            .filter(|l| l.has_code())
            .filter_map(|l| {
                Some(ProgramLine {
                    address: u16::from_str_radix(&l.line_no, 16).ok()?,
                    word: u16::from_str_radix(&format!("{}{}", l.hex_code, l.operand), 16).ok()?,
                    label: l.label.trim().to_string(),
                    mnemonic: l.mnemonic.trim().to_string(),
                    operand: l.operand_token.trim().to_string(),
                })
            })
            .collect();
        Some(Program { lines })
    }
}

fn instruction(mnemonic: &str) -> Option<(i32, bool)> {
    Some(match mnemonic {
        "JNS" => (0, true),
        "LOAD" => (1, true),
        "STORE" => (2, true),
        "ADD" => (3, true),
        "SUBT" => (4, true),
        "INPUT" => (5, false),
        "OUTPUT" => (6, false),
        "HALT" => (7, false),
        "SKIPCOND" => (8, true),
        "JUMP" => (9, true),
        "CLEAR" => (10, false),
        "ADDI" => (11, true),
        "JUMPI" => (12, true),
        "DEC" => (DEC, true),
        "OCT" => (OCT, true),
        "HEX" => (HEX, true),
        "ORG" => (ORG, true),
        "END" => (END, false),
        _ => return None,
    })
}

// Адресний літерал мусить починатися з цифри — інакше це мітка (`ADD F00`).
fn is_literal(token: &str) -> bool {
    token.starts_with(|c: char| c.is_ascii_digit()) && token.chars().all(|c| c.is_ascii_hexdigit())
}

// Відхилення від оригіналу: значення, менші за -32768, тут помилка
// (`validMarieValue` обгортав їх із неправильним знаком).
fn valid_value(n: i32) -> Option<i32> {
    match n {
        -32768..=32767 => Some(n),
        32768..=65535 => Some(n - 65536),
        _ => None,
    }
}

struct Entry {
    address: String,
    references: Vec<String>,
}

struct Assembler {
    // Адреса поточного оператора; -1 до першого рядка з кодом.
    line_number: i32,
    symbols: HashMap<String, Entry>,
    max_symbol_len: usize,
    errors: Vec<AsmError>,
    error_count: usize,
    done: bool,
}

impl Assembler {
    fn error(&mut self, e: AsmError) {
        self.error_count += 1;
        self.errors.push(e);
    }

    fn statement_label(&mut self, token: &str) -> (String, bool) {
        let Some(i) = token.find(',') else {
            return (" ".into(), false);
        };
        // Усе після коми в цьому ж токені відкидається, як в оригіналі.
        let symbol = &token[..i];
        if symbol.is_empty() {
            return (" ".into(), true);
        }
        if symbol.starts_with(|c: char| c.is_ascii_digit()) {
            self.error(AsmError::LabelStartsWithDigit);
            return (" ".into(), true);
        }
        if self.symbols.contains_key(symbol) {
            self.error(AsmError::DuplicateLabel);
            return (" ".into(), true);
        }
        self.symbols.insert(symbol.to_string(), Entry { address: hex3(self.line_number), references: Vec::new() });
        self.max_symbol_len = self.max_symbol_len.max(symbol.chars().count());
        (symbol.to_string(), true)
    }

    fn opcode(&mut self, mnemonic: &str, operand_reqd: &mut bool) -> i32 {
        let Some((code, reqd)) = instruction(mnemonic) else {
            self.error(AsmError::UnknownInstruction);
            return NOT_FOUND;
        };
        *operand_reqd = reqd;
        if code == ORG && self.line_number > 0 {
            self.error(AsmError::OrgNotFirst);
            return NOT_FOUND;
        }
        code
    }

    fn literal(&mut self, kind: i32, text: &str, directive: bool) -> i32 {
        let (radix, err) = match kind {
            DEC => (10, AsmError::InvalidDecimal),
            OCT => (8, AsmError::InvalidOctal),
            ORG => (16, AsmError::AddressOutOfRange),
            _ => (16, AsmError::InvalidHex),
        };
        let mut parsed = i32::from_str_radix(text, radix).ok().and_then(valid_value);
        // Відхилення від оригіналу: ORG поза 000..FFF — помилка.
        if kind == ORG {
            parsed = parsed.filter(|v| (0..=MAX_ADDR).contains(v));
        }
        let Some(value) = parsed else {
            self.error(err);
            return 0;
        };
        if !directive && !(0..=MAX_ADDR).contains(&value) {
            self.error(AsmError::AddressOutOfRange);
            return 0;
        }
        value
    }

    fn parse_line(&mut self, input: &str) -> CodeLine {
        let mut line = CodeLine::blank(input);
        self.errors.clear();

        let code_len = input.find('/').unwrap_or(input.len());
        if code_len > 0 && code_len < input.len() {
            line.comment = input[code_len..].to_string();
        }
        let mut tokens = input[..code_len].split([' ', '\t', '\r', '\x0C']).filter(|t| !t.is_empty());
        let Some(first) = tokens.next() else {
            line.comment = input.to_string();
            return line;
        };

        self.line_number += 1;
        if self.line_number > MAX_ADDR {
            self.error(AsmError::TooManyLines);
            line.errors = std::mem::take(&mut self.errors);
            self.done = true;
            return line;
        }

        let (label, has_label) = self.statement_label(first);
        line.label = label;

        let mut operand_reqd = true;
        let mut code;
        if has_label {
            match tokens.next() {
                Some(token) => {
                    line.mnemonic = token.to_uppercase();
                    code = self.opcode(&line.mnemonic, &mut operand_reqd);
                }
                None => {
                    self.error(AsmError::MissingInstruction);
                    operand_reqd = false;
                    code = NOT_FOUND;
                }
            }
        } else {
            line.mnemonic = first.to_uppercase();
            code = self.opcode(&line.mnemonic, &mut operand_reqd);
        }

        let mut operand = String::from("000");
        if operand_reqd {
            match tokens.next() {
                Some(token) if (ORG..0).contains(&code) => {
                    let upper = token.to_uppercase();
                    let value = self.literal(code, &upper, true);
                    line.operand_token = upper;
                    // ORG із помилкою в рядку генерує слово, як константа (так в оригіналі).
                    if code > ORG || !self.errors.is_empty() {
                        let word = hex4(value);
                        code = i32::from_str_radix(&word[..1], 16).unwrap_or(0);
                        operand = word[1..].to_string();
                    } else {
                        self.line_number = value - 1;
                        return line;
                    }
                }
                Some(token) if is_literal(token) => {
                    let value = self.literal(HEX, token, false);
                    operand = hex3(value);
                    line.operand_token = operand.clone();
                }
                Some(token) => {
                    // Символ розв'язується на другому проході.
                    operand = format!("_{token}");
                    line.operand_token = token.to_string();
                }
                None => {
                    self.error(AsmError::MissingOperand);
                    operand = "???".into();
                }
            }
        }

        line.line_no = hex3(self.line_number);
        if code >= 0 {
            line.hex_code = format!("{code:X}");
        } else if code < -15 {
            line.hex_code = "?".into();
        } else if code == END {
            line.line_no = "   ".into();
            operand = "   ".into();
            self.done = true;
        }
        line.operand = operand;
        line.errors = std::mem::take(&mut self.errors);
        line
    }

    fn resolve(&mut self, line: &mut CodeLine) {
        if !line.has_code() {
            return;
        }
        let Some(symbol) = line.operand.strip_prefix('_') else {
            return;
        };
        match self.symbols.get_mut(symbol) {
            Some(entry) => {
                entry.references.push(line.line_no.clone());
                line.operand = entry.address.clone();
            }
            None => {
                line.operand = "???".into();
                line.errors.push(AsmError::UndefinedOperand);
                self.error_count += 1;
            }
        }
    }
}

pub fn assemble(source: &str) -> Assembly {
    let mut asm = Assembler {
        line_number: -1,
        symbols: HashMap::new(),
        max_symbol_len: 0,
        errors: Vec::new(),
        error_count: 0,
        done: false,
    };

    let mut lines = Vec::new();
    for input in source.lines() {
        lines.push(asm.parse_line(input));
        if asm.done {
            break;
        }
    }
    for line in &mut lines {
        asm.resolve(line);
    }

    let mut symbols: Vec<Symbol> = asm
        .symbols
        .into_iter()
        .map(|(name, e)| Symbol { name, address: e.address, references: e.references })
        .collect();
    symbols.sort_by(|a, b| a.name.cmp(&b.name));

    Assembly { lines, symbols, error_count: asm.error_count, symbol_width: asm.max_symbol_len.clamp(6, 24) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(asm: &Assembly) -> Vec<(String, String)> {
        asm.lines
            .iter()
            .filter(|l| l.has_code())
            .map(|l| (l.line_no.clone(), format!("{}{}", l.hex_code, l.operand)))
            .collect()
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
        let expected = [
            ("100", "1107"),
            ("101", "6000"),
            ("102", "4108"),
            ("103", "2107"),
            ("104", "8400"),
            ("105", "9100"),
            ("106", "7000"),
            ("107", "0005"),
            ("108", "0001"),
        ];
        let got = words(&asm);
        assert_eq!(got.len(), expected.len());
        for ((addr, word), (a, w)) in got.iter().zip(expected) {
            assert_eq!((addr.as_str(), word.as_str()), (a, w));
        }
        let names: Vec<_> = asm.symbols.iter().map(|s| (s.name.as_str(), s.address.as_str())).collect();
        assert_eq!(names, [("Count", "107"), ("Loop", "100"), ("One", "108")]);
        assert_eq!(asm.symbols[0].references, ["100", "103"]);

        let program = asm.program().unwrap();
        assert_eq!(program.lines[0], ProgramLine {
            address: 0x100,
            word: 0x1107,
            label: "Loop".into(),
            mnemonic: "LOAD".into(),
            operand: "Count".into(),
        });
    }

    #[test]
    fn starts_at_zero_without_org() {
        let asm = assemble("Load X\nHalt\nX, DEC 7\n");
        assert_eq!(words(&asm), [("000".into(), "1002".into()), ("001".into(), "7000".into()), ("002".into(), "0007".into())]);
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
        assert_eq!(asm.lines[0].operand, "F00");
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
        assert_eq!(got, ["FFFF", "7FFF", "8000", "FFFF", "000F", "BABE", "FFFF"]);

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
        assert_eq!(words(&asm), [("FFF".into(), "7000".into())]);
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
        // Зайві токени ігноруються.
        assert!(errors("Halt 5\nClear x y\n").is_empty());
    }

    #[test]
    fn end_stops_reading() {
        let asm = assemble("Halt\nEND\nFoo bar\n");
        assert_eq!(asm.error_count, 0);
        assert_eq!(asm.lines.len(), 2);
        assert!(!asm.lines[1].has_code());
        assert_eq!(asm.program().unwrap().lines.len(), 1);
    }

    #[test]
    fn comments_and_blank_lines_take_no_address() {
        let asm = assemble("/ only comment\n\n   \nHalt / stop\n");
        assert_eq!(asm.lines[0].comment, "/ only comment");
        assert_eq!(asm.lines[3].comment, "/ stop");
        assert_eq!(words(&asm), [("000".into(), "7000".into())]);
    }

    #[test]
    fn errors_block_program() {
        let asm = assemble("Load X\n");
        assert_eq!(asm.error_count, 1);
        assert_eq!(asm.lines[0].operand, "???");
        assert!(asm.program().is_none());
    }

    #[test]
    fn too_many_lines() {
        let source = "ORG FFF\nHalt\nHalt\nHalt\n";
        let asm = assemble(source);
        assert_eq!(asm.lines.len(), 3);
        assert_eq!(asm.lines[2].errors, [AsmError::TooManyLines]);
    }
}
