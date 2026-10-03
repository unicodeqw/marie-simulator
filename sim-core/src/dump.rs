//! Core dump у форматі оригінального `.dmp`.

use crate::machine::Machine;
use crate::{format_address, format_word, Radix, ADDR_MASK};

/// Системи числення регістрів на панелі: дамп показує їх «як на екрані».
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Deserialize), serde(rename_all = "camelCase"))]
pub struct RegisterRadix {
    pub pc: Radix,
    pub mar: Radix,
    pub ac: Radix,
    pub ir: Radix,
    pub mbr: Radix,
}

// Оригінальний `Register.toString()`: значення з відступом, що залежить від
// системи числення; порожнє поле (нуль у режимі ASCII) друкується як `null`.
fn render(text: String, value: u16, radix: Radix, address: bool) -> String {
    let indent = match radix {
        Radix::Hex if address => "  ",
        Radix::Hex => " ",
        Radix::Dec if (value as i16) > 0 => " ",
        Radix::Dec => "",
        Radix::Ascii if text.is_empty() => return "null".into(),
        Radix::Ascii => "    ",
    };
    format!("{indent}{text}")
}

fn word(value: u16, radix: Radix) -> String {
    render(format_word(value, radix), value, radix, false)
}

fn address(value: u16, radix: Radix) -> String {
    render(format_address(value, radix), value, radix, true)
}

pub fn core_dump(m: &Machine, title: &str, timestamp: &str, start: u16, end: u16, radix: RegisterRadix) -> String {
    let r = m.registers();
    let (start, end) = (start.min(end) & ADDR_MASK, start.max(end) & ADDR_MASK);

    let mut out = format!("Machine dump for {title}           {timestamp}\n\n\n");
    out += &format!(
        "    PC: {}   MAR: {}      AC: {}\n",
        address(r.pc, radix.pc),
        address(r.mar, radix.mar),
        word(r.ac, radix.ac)
    );
    out += &format!(
        "    IR: {}   MBR: {}   INPUT:  {}  OUTPUT: {}\n",
        word(r.ir, radix.ir),
        word(r.mbr, radix.mbr),
        word(r.input, m.input_radix()).trim(),
        word(r.output, m.output_radix()).trim()
    );
    out += &format!("\n       Memory dump for addresses {start:03X} through {end:03X}\n\n");

    for (i, address) in (start..=end).enumerate() {
        if i % 8 == 0 {
            out += &format!(" {address:03X}:  ");
        }
        out += &format!(" {:04X}  ", m.memory()[address as usize]);
        if i % 8 == 7 || address == end {
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assemble;

    #[test]
    fn dump_layout() {
        let mut m = Machine::new();
        m.load(assemble("ORG 100\nLoad X\nOutput\nHalt\nX, DEC 65\n").program().unwrap());
        m.run(100, false);
        let text = core_dump(&m, "demo.mas", "NOW", 0x100, 0x109, RegisterRadix::default());
        let expected = "\
Machine dump for demo.mas           NOW


    PC:   103   MAR:   102      AC:  0041
    IR:  7000   MBR:  0041   INPUT:  null  OUTPUT: A

       Memory dump for addresses 100 through 109

 100:   1103   6000   7000   0041   0000   0000   0000   0000\x20\x20
 108:   0000   0000\x20\x20
";
        assert_eq!(text, expected);
    }

    #[test]
    fn registers_follow_their_radix() {
        let mut m = Machine::new();
        m.load(assemble("Load X\nHalt\nX, DEC -2\n").program().unwrap());
        m.run(100, false);
        m.set_input_radix(Radix::Dec);
        let radix = RegisterRadix { ac: Radix::Dec, pc: Radix::Dec, ..RegisterRadix::default() };
        let text = core_dump(&m, "t", "", 5, 0, radix);
        assert!(text.contains("    PC:  2   MAR:   001      AC: -2\n"));
        assert!(text.contains("INPUT:  0  OUTPUT: null\n"));
        assert!(text.contains("addresses 000 through 005\n\n 000:   1002   7000   FFFE   0000   0000   0000  \n"));
    }
}
