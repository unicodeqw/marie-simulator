//! WebAssembly-обгортка над `sim-core`. Після кожної дії інтерфейс сам
//! перечитує `snapshot()`; методи виконання повертають лише, чи готова
//! машина до наступної команди.

use serde::Serialize;
use sim_core::{CodeLine, Instruction, Machine, Program, Radix, RegisterRadix, State, Symbol};
use wasm_bindgen::prelude::*;

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    // json_compatible: None → null, u64 → number, flatten → звичайний об'єкт.
    Ok(value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())?)
}

// Назви ті самі, що серіалізує `Radix`: "hex", "dec", "ascii".
fn radix(name: &str) -> Result<Radix, JsError> {
    Ok(serde_wasm_bindgen::from_value(JsValue::from_str(name))?)
}

#[derive(Serialize)]
struct InstructionSet {
    instructions: &'static [Instruction],
    directives: &'static [&'static str],
}

/// Система команд і директиви асемблера — єдине джерело для інтерфейсу.
#[wasm_bindgen(js_name = instructionSet)]
pub fn instruction_set() -> Result<JsValue, JsError> {
    to_js(&InstructionSet { instructions: &sim_core::INSTRUCTIONS, directives: &sim_core::DIRECTIVES })
}

/// Значення регістра в системі числення `radix`; `address` — 12-бітні PC і MAR.
#[wasm_bindgen(js_name = formatWord)]
pub fn format_word(value: u16, radix_name: &str, address: bool) -> Result<String, JsError> {
    let radix = radix(radix_name)?;
    Ok(if address { sim_core::format_address(value, radix) } else { sim_core::format_word(value, radix) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssemblyReport<'a> {
    lines: &'a [CodeLine],
    symbols: &'a [Symbol],
    error_count: usize,
    listing: String,
    map: Option<String>,
    program: Option<Program>,
}

/// Асемблює вихідний текст; `fileName` і `timestamp` потрапляють у заголовок лістингу.
#[wasm_bindgen]
pub fn assemble(source: &str, file_name: &str, timestamp: &str) -> Result<JsValue, JsError> {
    let asm = sim_core::assemble(source);
    to_js(&AssemblyReport {
        lines: &asm.lines,
        symbols: &asm.symbols,
        error_count: asm.error_count,
        listing: sim_core::listing(&asm, file_name, timestamp),
        map: sim_core::symbol_map(&asm),
        program: asm.program(),
    })
}

#[derive(Serialize)]
struct MexReport {
    program: Program,
    source: String,
}

/// Розбирає оригінальний `.mex`; повертає програму й відновлений вихідний текст.
#[wasm_bindgen(js_name = readMex)]
pub fn read_mex(data: &[u8]) -> Result<JsValue, JsError> {
    let mex = sim_core::read_mex(data).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&MexReport { program: mex.program, source: mex.source })
}

#[wasm_bindgen]
#[derive(Default)]
pub struct Simulator {
    m: Machine,
}

#[wasm_bindgen]
impl Simulator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Simulator {
        Simulator::default()
    }

    pub fn load(&mut self, program: JsValue) -> Result<bool, JsError> {
        Ok(self.m.load(serde_wasm_bindgen::from_value(program)?))
    }
    pub fn reload(&mut self) {
        self.m.reload();
    }
    pub fn restart(&mut self) {
        self.m.restart();
    }
    pub fn reset(&mut self) {
        self.m.reset();
    }
    /// Одна команда; `true` — машина готова до наступної.
    pub fn step(&mut self) -> bool {
        self.m.step() == State::Ready
    }
    /// До `max` команд; `true` — машина готова продовжувати.
    pub fn run(&mut self, max: u32, breakpoints: bool) -> bool {
        self.m.run(max, breakpoints) == State::Ready
    }
    #[wasm_bindgen(js_name = provideInput)]
    pub fn provide_input(&mut self, text: &str) {
        self.m.provide_input(text);
    }

    #[wasm_bindgen(js_name = toggleBreakpoint)]
    pub fn toggle_breakpoint(&mut self, row: usize) {
        self.m.toggle_breakpoint(row);
    }
    #[wasm_bindgen(js_name = clearBreakpoints)]
    pub fn clear_breakpoints(&mut self) {
        self.m.clear_breakpoints();
    }

    #[wasm_bindgen(js_name = setInputRadix)]
    pub fn set_input_radix(&mut self, name: &str) -> Result<(), JsError> {
        self.m.set_input_radix(radix(name)?);
        Ok(())
    }
    #[wasm_bindgen(js_name = setOutputRadix)]
    pub fn set_output_radix(&mut self, name: &str) -> Result<(), JsError> {
        self.m.set_output_radix(radix(name)?);
        Ok(())
    }
    #[wasm_bindgen(js_name = setOutputLinefeed)]
    pub fn set_output_linefeed(&mut self, on: bool) {
        self.m.set_output_linefeed(on);
    }
    #[wasm_bindgen(js_name = clearOutput)]
    pub fn clear_output(&mut self) {
        self.m.clear_output();
    }
    /// Текст виводу, починаючи зі значення номер `from`.
    #[wasm_bindgen(js_name = outputText)]
    pub fn output_text(&self, from: usize) -> String {
        self.m.output_text(from)
    }

    pub fn snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&self.m.snapshot())
    }
    pub fn program(&self) -> Result<JsValue, JsError> {
        to_js(self.m.program())
    }
    /// Копія всієї пам'яті (4096 слів) як `Uint16Array`.
    pub fn memory(&self) -> Vec<u16> {
        self.m.memory().to_vec()
    }

    #[wasm_bindgen(js_name = coreDump)]
    pub fn core_dump(
        &self,
        title: &str,
        timestamp: &str,
        start: u16,
        end: u16,
        radix: JsValue,
    ) -> Result<String, JsError> {
        let radix: RegisterRadix = serde_wasm_bindgen::from_value(radix)?;
        Ok(sim_core::core_dump(&self.m, title, timestamp, start, end, radix))
    }
}

#[wasm_bindgen]
#[derive(Default)]
pub struct DataPath {
    d: sim_core::DataPath,
}

#[wasm_bindgen]
impl DataPath {
    #[wasm_bindgen(constructor)]
    pub fn new() -> DataPath {
        DataPath::default()
    }

    pub fn load(&mut self, program: JsValue) -> Result<bool, JsError> {
        Ok(self.d.load(serde_wasm_bindgen::from_value(program)?))
    }
    pub fn restart(&mut self) {
        self.d.restart();
    }
    pub fn reset(&mut self) {
        self.d.reset();
    }
    /// Наступний кадр анімації; `true` — команда завершилася.
    pub fn tick(&mut self) -> bool {
        self.d.tick()
    }
    #[wasm_bindgen(js_name = provideInput)]
    pub fn provide_input(&mut self, text: &str) {
        self.d.provide_input(text);
    }
    #[wasm_bindgen(js_name = setInputRadix)]
    pub fn set_input_radix(&mut self, name: &str) -> Result<(), JsError> {
        self.d.set_input_radix(radix(name)?);
        Ok(())
    }

    pub fn snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&self.d.snapshot())
    }
    pub fn program(&self) -> Result<JsValue, JsError> {
        to_js(self.d.program())
    }
    /// Рядки трасування з номера `from` (від рестарту); зберігаються лише останні.
    pub fn trace(&self, from: usize) -> Vec<String> {
        self.d.trace(from).map(str::to_string).collect()
    }
    /// Слово пам'яті за адресою (для показу M[MAR] на схемі).
    pub fn peek(&self, address: u16) -> u16 {
        self.d.memory()[(address & sim_core::ADDR_MASK) as usize]
    }
}
