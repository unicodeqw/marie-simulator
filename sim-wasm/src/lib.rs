//! WebAssembly-обгортка над `sim-core`. Після кожної дії інтерфейс сам
//! перечитує `snapshot()`, тож методи керування нічого не повертають.

use serde::Serialize;
use sim_core::{CodeLine, Machine, Program, Radix, RegisterRadix, Symbol};
use wasm_bindgen::prelude::*;

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    // json_compatible: None → null, u64 → number.
    Ok(value.serialize(&serde_wasm_bindgen::Serializer::json_compatible())?)
}

fn radix(name: &str) -> Radix {
    match name {
        "dec" => Radix::Dec,
        "ascii" => Radix::Ascii,
        _ => Radix::Hex,
    }
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
    pub fn step(&mut self) {
        self.m.step();
    }
    pub fn run(&mut self, max: u32, breakpoints: bool) {
        self.m.run(max, breakpoints);
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
    pub fn set_input_radix(&mut self, name: &str) {
        self.m.input_radix = radix(name);
    }
    #[wasm_bindgen(js_name = setOutputRadix)]
    pub fn set_output_radix(&mut self, name: &str) {
        self.m.output_radix = radix(name);
    }
    #[wasm_bindgen(js_name = setOutputLinefeed)]
    pub fn set_output_linefeed(&mut self, on: bool) {
        self.m.output_linefeed = on;
    }
    #[wasm_bindgen(js_name = clearOutput)]
    pub fn clear_output(&mut self) {
        self.m.clear_output();
    }
    #[wasm_bindgen(js_name = outputText)]
    pub fn output_text(&self) -> String {
        self.m.output_text()
    }

    pub fn snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&self.m.snapshot())
    }
    pub fn program(&self) -> Result<JsValue, JsError> {
        to_js(self.m.program())
    }
    /// Копія всієї пам'яті (4096 слів) як `Uint16Array`.
    pub fn memory(&self) -> Vec<u16> {
        self.m.cpu().mem.clone()
    }

    #[wasm_bindgen(js_name = coreDump)]
    pub fn core_dump(&self, title: &str, timestamp: &str, start: u16, end: u16, radix: JsValue) -> Result<String, JsError> {
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
    pub fn set_input_radix(&mut self, name: &str) {
        self.d.input_radix = radix(name);
    }

    pub fn snapshot(&self) -> Result<JsValue, JsError> {
        to_js(&self.d.snapshot())
    }
    pub fn program(&self) -> Result<JsValue, JsError> {
        to_js(self.d.program())
    }
    /// Слово пам'яті за адресою (для показу M[MAR] на схемі).
    pub fn peek(&self, address: u16) -> u16 {
        self.d.cpu().mem[(address & sim_core::ADDR_MASK) as usize]
    }
    /// Рядки трасування, починаючи з `from`.
    pub fn trace(&self, from: usize) -> Vec<String> {
        self.d.trace(from).to_vec()
    }
}
