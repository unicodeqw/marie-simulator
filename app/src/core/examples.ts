/** Вбудовані програми-приклади; назви — у словнику i18n за `id`. */
export interface Example {
  id: 'sum' | 'input' | 'countdown' | 'multiply' | 'subroutine' | 'indirect'
  fileName: string
  source: string
}

export const EXAMPLES: Example[] = [
  {
    id: 'sum',
    fileName: 'sum.mas',
    source: `/ Сума трьох чисел: r = x + y + z, результат на екран
        ORG 100
        Load X
        Add Y
        Add Z
        Store R
        Output
        Halt
X,      DEC 3
Y,      DEC 5
Z,      DEC 15
R,      DEC 0
`,
  },
  {
    id: 'input',
    fileName: 'input.mas',
    source: `/ r = x + 2y, де x вводиться з клавіатури
/ Для чисел перемкніть ввід і вивід у режим DEC
        ORG 100
        Input
        Store X
        Load Y
        Add Y
        Add X
        Store R
        Output
        Halt
X,      DEC 0
Y,      DEC 22
R,      DEC 0
`,
  },
  {
    id: 'countdown',
    fileName: 'countdown.mas',
    source: `/ Зворотний відлік: друкує 5, 4, 3, 2, 1
        ORG 100
Loop,   Load Count      / AC ← лічильник
        Output          / друк значення
        Subt One        / AC ← AC − 1
        Store Count
        Skipcond 400    / пропустити Jump, якщо AC = 0
        Jump Loop
        Halt
Count,  DEC 5
One,    DEC 1
`,
  },
  {
    id: 'multiply',
    fileName: 'multiply.mas',
    source: `/ r = 12 * (x + y): множення через додавання в циклі
/ x та y вводяться з клавіатури (режим DEC)
        ORG 100
        Input
        Store X
        Input
        Add X
        Store Sum       / Sum = x + y
Loop,   Load R
        Add Sum
        Store R         / R = R + Sum
        Load Count
        Subt One
        Store Count
        Skipcond 400    / вихід із циклу, коли лічильник = 0
        Jump Loop
        Load R
        Output
        Halt
X,      DEC 0
Sum,    DEC 0
R,      DEC 0
Count,  DEC 12
One,    DEC 1
`,
  },
  {
    id: 'subroutine',
    fileName: 'subroutine.mas',
    source: `/ Підпрограма подвоєння: JnS зберігає адресу повернення, JumpI повертає
        ORG 100
        Load A
        Store Arg
        JnS Double
        Output
        Load B
        Store Arg
        JnS Double
        Output
        Halt
A,      DEC 21
B,      DEC 50
Arg,    DEC 0
Double, HEX 0           / сюди JnS запише адресу повернення
        Load Arg
        Add Arg
        JumpI Double
`,
  },
  {
    id: 'indirect',
    fileName: 'indirect.mas',
    source: `/ Сума масиву через непряму адресацію (AddI)
        ORG 100
Loop,   Load Sum
        AddI Ptr        / AC ← AC + M[M[Ptr]]
        Store Sum
        Load Ptr
        Add One
        Store Ptr       / наступний елемент
        Load Count
        Subt One
        Store Count
        Skipcond 400
        Jump Loop
        Load Sum
        Output
        Halt
Ptr,    HEX 112         / адреса першого елемента
Count,  DEC 5
Sum,    DEC 0
One,    DEC 1
        DEC 10
        DEC 15
        DEC 20
        DEC 25
        DEC 30
`,
  },
]
