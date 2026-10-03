//! Тексти `.lst` і `.map` у форматі оригінального асемблера.

use crate::assembler::{Assembly, Code};

const INDENT: &str = "         ";

// Оригінальний `padStr`: доповнює пробілами або обрізає до `size`.
fn pad(s: &str, size: usize) -> String {
    let mut out: String = s.chars().take(size).collect();
    let len = out.chars().count();
    out.push_str(&" ".repeat(size - len));
    out
}

// Ширина колонки символу: найдовша мітка, але в межах 6..=24.
fn label_width(asm: &Assembly) -> usize {
    asm.symbols.iter().map(|s| s.name.chars().count()).max().unwrap_or(0).clamp(6, 24)
}

// Адреса й слово: `100 1107`; незібрані частини — `?` і `???`, рядок без коду — пробіли.
fn code_columns(code: Option<Code>) -> String {
    let Some(code) = code else {
        return " ".repeat(8);
    };
    let opcode = code.opcode.map_or("?".into(), |o| format!("{o:X}"));
    let operand = code.operand.map_or("???".into(), |o| format!("{o:03X}"));
    format!("{:03X} {opcode}{operand}", code.address)
}

/// Лістинг із таблицею символів. `file_name` і `timestamp` ідуть у заголовок.
pub fn listing(asm: &Assembly, file_name: &str, timestamp: &str) -> String {
    let w = label_width(asm);
    // Скільки символів додається до ширини мітки в рамках таблиці.
    let extra = w - 5;
    let mut out = format!("     Assembly listing for: {file_name}\n                Assembled: {timestamp}\n\n");

    for l in &asm.lines {
        // Порожні поля оригінал друкував одним пробілом.
        let mnemonic = l.mnemonic.as_deref().unwrap_or(" ");
        let operand_width = (w + 9).saturating_sub(mnemonic.chars().count());
        out += &format!(
            "{} |  {} {} {} {}\n",
            code_columns(l.code),
            pad(l.label.as_deref().unwrap_or(""), w),
            mnemonic,
            pad(l.operand.as_deref().unwrap_or(""), operand_width),
            l.comment.as_deref().unwrap_or(" ")
        );
        for e in &l.errors {
            out += &format!("   **** {e}\n");
        }
    }

    out.push('\n');
    out += &match asm.error_count {
        0 => "Assembly successful.\n".to_string(),
        1 => "1 error found.  Assembly unsuccessful.\n".to_string(),
        n => format!("{n} errors found.  Assembly unsuccessful.\n"),
    };

    let rule = format!("{INDENT}-------{}------------------------------------------\n", "-".repeat(extra));
    out += &format!("\n{INDENT}SYMBOL TABLE\n{rule}");
    out += &format!("{INDENT} Symbol{}| Defined | References \n", " ".repeat(extra));
    out += &format!("{INDENT}-------{}+---------+-------------------------------", "-".repeat(extra));
    for s in &asm.symbols {
        out += &format!("\n{INDENT} {} |   {:03X}   | ", pad(&s.name, w), s.address);
        for (i, r) in s.references.iter().enumerate() {
            if i > 0 {
                out += ", ";
                // Після кожних шести посилань — новий рядок таблиці.
                if i % 6 == 0 {
                    out += &format!("\n{INDENT}{}  |{INDENT}| ", pad("", w));
                }
            }
            out += &format!("{r:03X}");
        }
    }
    out += &format!("\n{rule}\n");
    out
}

/// Таблиця символів для `.map`; оригінал пише її лише після успішного асемблювання.
pub fn symbol_map(asm: &Assembly) -> Option<String> {
    if asm.error_count > 0 {
        return None;
    }
    let w = label_width(asm);
    let mut out = format!(" -----{}----------\n", "-".repeat(w - 4));
    out += &format!(" Symbol{}| Location\n", " ".repeat(w - 5));
    out += &format!(" -----{}+---------", "-".repeat(w - 4));
    for s in &asm.symbols {
        out += &format!("\n {} |   {:03X}", pad(&s.name, w), s.address);
    }
    out.push('\n');
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assemble;

    #[test]
    fn listing_layout() {
        let asm = assemble("/ Demo\n\tORG 100\nLoop,\tLoad Count\t/ counter\n\tJump Loop\nCount,\tDEC 5\n");
        let expected = [
            "     Assembly listing for: demo.mas",
            "                Assembled: NOW",
            "",
            "         |                          / Demo",
            "         |         ORG 100           ",
            "100 1102 |  Loop   LOAD Count       / counter",
            "101 9100 |         JUMP Loop         ",
            "102 0005 |  Count  DEC 5             ",
            "",
            "Assembly successful.",
            "",
            "         SYMBOL TABLE",
            "         --------------------------------------------------",
            "          Symbol | Defined | References ",
            "         --------+---------+-------------------------------",
            "          Count  |   102   | 100",
            "          Loop   |   100   | 101",
            "         --------------------------------------------------",
            "",
            "",
        ];
        assert_eq!(listing(&asm, "demo.mas", "NOW"), expected.join("\n"));
    }

    #[test]
    fn listing_reports_errors() {
        let asm = assemble("Load X\nFoo\n");
        let text = listing(&asm, "bad.mas", "NOW");
        let load = format!("000 1??? |  {:6} LOAD {:11}  \n   **** Operand undefined.\n", "", "X");
        assert!(text.contains(&load), "{text}");
        assert!(text.contains("   **** Instruction not recognized.\n   **** Missing operand.\n"));
        assert!(text.contains("\n3 errors found.  Assembly unsuccessful.\n"));
        assert!(symbol_map(&asm).is_none());
        assert!(listing(&assemble("Foo 1\n"), "x", "").contains("\n1 error found.  Assembly unsuccessful.\n"));
    }

    #[test]
    fn references_wrap_after_six() {
        let source = "X, DEC 1\n".to_string() + &"Load X\n".repeat(8);
        let text = listing(&assemble(&source), "x.mas", "");
        let row = format!(
            "{INDENT} X      |   000   | 001, 002, 003, 004, 005, 006, \n{INDENT}{:6}  |{INDENT}| 007, 008\n",
            ""
        );
        assert!(text.contains(&row), "{text}");
    }

    #[test]
    fn map_layout() {
        let asm = assemble("LongerLabel, DEC 1\nB, DEC 2\n");
        let expected = [
            " ----------------------",
            " Symbol      | Location",
            " ------------+---------",
            " B           |   001",
            " LongerLabel |   000",
            "",
        ];
        assert_eq!(symbol_map(&asm).unwrap(), expected.join("\n"));
    }
}
