//! Читання оригінальних `.mex`: це потік Java-серіалізації з об'єктами
//! `AssembledCodeLine`. Розбирається лише та частина протоколу, яку
//! породжує `ObjectOutputStream` для рядків і `ArrayList`.

use std::collections::HashMap;
use std::fmt;
use std::rc::Rc;

use crate::machine::{Program, ProgramLine};

const TC_NULL: u8 = 0x70;
const TC_REFERENCE: u8 = 0x71;
const TC_CLASSDESC: u8 = 0x72;
const TC_OBJECT: u8 = 0x73;
const TC_STRING: u8 = 0x74;
const TC_BLOCKDATA: u8 = 0x77;
const TC_ENDBLOCKDATA: u8 = 0x78;
const TC_LONGSTRING: u8 = 0x7C;
const BASE_HANDLE: u32 = 0x7E_0000;
const SC_WRITE_METHOD: u8 = 0x01;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MexError {
    NotMex,
    Truncated,
    Unsupported,
    Empty,
}

impl fmt::Display for MexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            MexError::NotMex => "not a MARIE executable (.mex) file",
            MexError::Truncated => "unexpected end of .mex file",
            MexError::Unsupported => "unsupported data in .mex file",
            MexError::Empty => "no program statements in .mex file",
        })
    }
}

/// Програма з `.mex` і вихідний текст, відновлений із поля `sourceLine`.
#[derive(Clone, Debug, PartialEq)]
pub struct MexFile {
    pub program: Program,
    pub source: String,
}

struct ClassDesc {
    name: String,
    flags: u8,
    // (код типу, ім'я поля)
    fields: Vec<(u8, String)>,
    parent: Option<Rc<ClassDesc>>,
}

#[derive(Clone)]
enum Value {
    Null,
    Str(Rc<str>),
    Object(Rc<Object>),
    Class(Rc<ClassDesc>),
}

struct Object {
    class: String,
    strings: HashMap<String, Rc<str>>,
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
    // Усе, на що потік може послатися через TC_REFERENCE, у порядку появи.
    handles: Vec<Value>,
}

impl<'a> Reader<'a> {
    fn bytes(&mut self, n: usize) -> Result<&'a [u8], MexError> {
        let end = self.pos.checked_add(n).filter(|&e| e <= self.data.len()).ok_or(MexError::Truncated)?;
        let slice = &self.data[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, MexError> {
        Ok(self.bytes(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, MexError> {
        let b = self.bytes(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> Result<u32, MexError> {
        let b = self.bytes(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn utf(&mut self) -> Result<String, MexError> {
        let len = self.u16()? as usize;
        Ok(String::from_utf8_lossy(self.bytes(len)?).into_owned())
    }

    fn class_desc(&mut self) -> Result<Option<Rc<ClassDesc>>, MexError> {
        match self.u8()? {
            TC_NULL => Ok(None),
            TC_REFERENCE => match self.reference()? {
                Value::Class(c) => Ok(Some(c)),
                _ => Err(MexError::Unsupported),
            },
            TC_CLASSDESC => {
                let name = self.utf()?;
                self.bytes(8)?; // serialVersionUID
                let slot = self.handles.len();
                self.handles.push(Value::Null);
                let flags = self.u8()?;
                let mut fields = Vec::new();
                for _ in 0..self.u16()? {
                    let code = self.u8()?;
                    let field = self.utf()?;
                    if code == b'L' || code == b'[' {
                        self.value()?; // ім'я типу поля
                    }
                    fields.push((code, field));
                }
                self.annotations()?;
                let parent = self.class_desc()?;
                let desc = Rc::new(ClassDesc { name, flags, fields, parent });
                self.handles[slot] = Value::Class(desc.clone());
                Ok(Some(desc))
            }
            _ => Err(MexError::Unsupported),
        }
    }

    fn reference(&mut self) -> Result<Value, MexError> {
        let index = self.u32()?.checked_sub(BASE_HANDLE).ok_or(MexError::Unsupported)? as usize;
        self.handles.get(index).cloned().ok_or(MexError::Unsupported)
    }

    // Довільні дані до TC_ENDBLOCKDATA (вміст ArrayList тощо) пропускаються.
    fn annotations(&mut self) -> Result<(), MexError> {
        loop {
            match self.data.get(self.pos) {
                Some(&TC_ENDBLOCKDATA) => {
                    self.pos += 1;
                    return Ok(());
                }
                Some(&TC_BLOCKDATA) => {
                    self.pos += 1;
                    let len = self.u8()? as usize;
                    self.bytes(len)?;
                }
                Some(_) => {
                    self.value()?;
                }
                None => return Err(MexError::Truncated),
            }
        }
    }

    fn value(&mut self) -> Result<Value, MexError> {
        match self.u8()? {
            TC_NULL => Ok(Value::Null),
            TC_REFERENCE => self.reference(),
            TC_STRING => {
                let s: Rc<str> = self.utf()?.into();
                self.handles.push(Value::Str(s.clone()));
                Ok(Value::Str(s))
            }
            TC_LONGSTRING => {
                self.u32()?; // старші 4 байти довжини
                let len = self.u32()? as usize;
                let s: Rc<str> = String::from_utf8_lossy(self.bytes(len)?).into();
                self.handles.push(Value::Str(s.clone()));
                Ok(Value::Str(s))
            }
            TC_OBJECT => {
                let desc = self.class_desc()?.ok_or(MexError::Unsupported)?;
                let slot = self.handles.len();
                self.handles.push(Value::Null);

                // Дані класів ідуть від найстаршого предка до самого класу.
                let mut chain = Vec::new();
                let mut next = Some(desc.clone());
                while let Some(c) = next {
                    next = c.parent.clone();
                    chain.push(c);
                }
                let mut strings = HashMap::new();
                for class in chain.iter().rev() {
                    for (code, field) in &class.fields {
                        match *code {
                            b'B' | b'Z' => drop(self.bytes(1)?),
                            b'C' | b'S' => drop(self.bytes(2)?),
                            b'I' | b'F' => drop(self.bytes(4)?),
                            b'J' | b'D' => drop(self.bytes(8)?),
                            _ => {
                                if let Value::Str(s) = self.value()? {
                                    strings.insert(field.clone(), s);
                                }
                            }
                        }
                    }
                    if class.flags & SC_WRITE_METHOD != 0 {
                        self.annotations()?;
                    }
                }
                let object = Value::Object(Rc::new(Object { class: desc.name.clone(), strings }));
                self.handles[slot] = object.clone();
                Ok(object)
            }
            _ => Err(MexError::Unsupported),
        }
    }
}

pub fn read_mex(data: &[u8]) -> Result<MexFile, MexError> {
    if data.len() < 4 || data[..4] != [0xAC, 0xED, 0x00, 0x05] {
        return Err(MexError::NotMex);
    }
    let mut reader = Reader { data, pos: 4, handles: Vec::new() };
    let mut lines = Vec::new();
    let mut source = String::new();

    while reader.pos < data.len() {
        let Value::Object(object) = reader.value()? else {
            return Err(MexError::Unsupported);
        };
        if !object.class.ends_with("AssembledCodeLine") {
            return Err(MexError::NotMex);
        }
        let field = |name: &str| object.strings.get(name).map_or("", |s| &**s);
        source += field("sourceLine");
        source.push('\n');

        // Рядки без коду мають номер із пробілів.
        let line_no = field("lineNo");
        if line_no.starts_with(' ') || line_no.is_empty() {
            continue;
        }
        let word = format!("{}{}", field("hexCode"), field("operand"));
        let (Ok(address), Ok(word)) = (u16::from_str_radix(line_no, 16), u16::from_str_radix(&word, 16)) else {
            return Err(MexError::Unsupported);
        };
        lines.push(ProgramLine {
            address,
            word,
            label: field("stmtLabel").trim().to_string(),
            mnemonic: field("mnemonic").trim().to_string(),
            operand: field("operandToken").trim().to_string(),
        });
    }

    if lines.is_empty() {
        return Err(MexError::Empty);
    }
    Ok(MexFile { program: Program { lines }, source })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Мінімальний запис потоку за специфікацією Java Object Serialization:
    // повторні рядки й описи класів ідуть як TC_REFERENCE, як у справжньому .mex.
    struct Writer {
        out: Vec<u8>,
        next_handle: u32,
        strings: HashMap<String, u32>,
        line_class: Option<u32>,
        list_class: Option<u32>,
    }

    const FIELDS: [&str; 9] =
        ["comment", "errors", "hexCode", "lineNo", "mnemonic", "operand", "operandToken", "sourceLine", "stmtLabel"];

    impl Writer {
        fn new() -> Writer {
            Writer {
                out: vec![0xAC, 0xED, 0x00, 0x05],
                next_handle: BASE_HANDLE,
                strings: HashMap::new(),
                line_class: None,
                list_class: None,
            }
        }

        fn handle(&mut self) -> u32 {
            self.next_handle += 1;
            self.next_handle - 1
        }

        fn utf(&mut self, s: &str) {
            self.out.extend((s.len() as u16).to_be_bytes());
            self.out.extend(s.as_bytes());
        }

        fn reference(&mut self, handle: u32) {
            self.out.push(TC_REFERENCE);
            self.out.extend(handle.to_be_bytes());
        }

        fn string(&mut self, s: &str) {
            if let Some(&h) = self.strings.get(s) {
                return self.reference(h);
            }
            self.out.push(TC_STRING);
            self.utf(s);
            let h = self.handle();
            self.strings.insert(s.to_string(), h);
        }

        fn line_class_desc(&mut self) {
            if let Some(h) = self.line_class {
                return self.reference(h);
            }
            self.out.push(TC_CLASSDESC);
            self.utf("MarieSimulator.AssembledCodeLine");
            self.out.extend([0u8; 8]);
            self.line_class = Some(self.handle());
            self.out.push(0x02);
            self.out.extend((FIELDS.len() as u16).to_be_bytes());
            for name in FIELDS {
                self.out.push(b'L');
                self.utf(name);
                self.string(if name == "errors" { "Ljava/util/ArrayList;" } else { "Ljava/lang/String;" });
            }
            self.out.extend([TC_ENDBLOCKDATA, TC_NULL]);
        }

        fn empty_list(&mut self) {
            self.out.push(TC_OBJECT);
            match self.list_class {
                Some(h) => self.reference(h),
                None => {
                    self.out.push(TC_CLASSDESC);
                    self.utf("java.util.ArrayList");
                    self.out.extend(0x7881_D21D_99C7_619D_u64.to_be_bytes());
                    self.list_class = Some(self.handle());
                    self.out.push(0x03);
                    self.out.extend(1u16.to_be_bytes());
                    self.out.push(b'I');
                    self.utf("size");
                    self.out.extend([TC_ENDBLOCKDATA, TC_NULL]);
                }
            }
            self.handle();
            self.out.extend(0u32.to_be_bytes()); // size
            self.out.extend([TC_BLOCKDATA, 4, 0, 0, 0, 10, TC_ENDBLOCKDATA]); // capacity
        }

        // Значення в порядку FIELDS, без `errors`.
        fn line(&mut self, values: [&str; 8]) {
            self.out.push(TC_OBJECT);
            self.line_class_desc();
            self.handle();
            let mut values = values.into_iter();
            for name in FIELDS {
                if name == "errors" {
                    self.empty_list();
                } else {
                    self.string(values.next().unwrap());
                }
            }
        }
    }

    fn sample() -> Vec<u8> {
        let mut w = Writer::new();
        w.line(["/ demo", " ", "     ", " ", " ", " ", "/ demo", " "]);
        w.line([" ", " ", "     ", "ORG", " ", "100", "\tORG 100", " "]);
        w.line(["/ load", "1", "100", "LOAD", "102", "X", "Go,\tLoad X\t/ load", "Go"]);
        w.line([" ", "7", "101", "HALT", "000", " ", "\tHalt", " "]);
        w.line([" ", "0", "102", "DEC", "007", "7", "X,\tDec 7", "X"]);
        w.out
    }

    #[test]
    fn reads_program_and_source() {
        let mex = read_mex(&sample()).unwrap();
        assert_eq!(mex.program.lines.len(), 3);
        assert_eq!(mex.program.lines[0], ProgramLine {
            address: 0x100,
            word: 0x1102,
            label: "Go".into(),
            mnemonic: "LOAD".into(),
            operand: "X".into(),
        });
        assert_eq!(mex.program.lines[2].word, 7);
        assert_eq!(mex.source, "/ demo\n\tORG 100\nGo,\tLoad X\t/ load\n\tHalt\nX,\tDec 7\n");
    }

    #[test]
    fn rejects_other_data() {
        assert_eq!(read_mex(b"Load X\n"), Err(MexError::NotMex));
        let data = sample();
        assert_eq!(read_mex(&data[..data.len() - 3]), Err(MexError::Truncated));

        let mut w = Writer::new();
        w.line(["/ only a comment", " ", "     ", " ", " ", " ", "/ only a comment", " "]);
        assert_eq!(read_mex(&w.out), Err(MexError::Empty));
    }
}
