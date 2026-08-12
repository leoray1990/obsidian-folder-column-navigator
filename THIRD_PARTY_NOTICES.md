# Third-party notices

## Release runtime dependencies

- [pinyin-pro 3.28.1](https://www.npmjs.com/package/pinyin-pro/v/3.28.1) — MIT.
  It is bundled into `main.js` solely to implement Chinese pinyin, initials, and mixed-pinyin filtering. The package declares no transitive runtime dependencies.
- [FullCalendar Standard 6.1.21](https://fullcalendar.io/) — MIT.
  The bundled `core`, `daygrid`, `interaction`, and `multimonth` packages render the bottom calendar, including month/year views, week numbers, and date clicks. Its bundled runtime dependency [Preact 10.12.1](https://preactjs.com/) is also MIT.

```text
MIT License

Copyright (c) 2022-present zh-lx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```text
MIT License

Copyright (c) 2021 Adam Shaw
Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development-only dependencies

These packages are used to type-check or bundle the source. They are not included in the release assets (`main.js`, `manifest.json`, and `styles.css`).

- [esbuild 0.28.2](https://github.com/evanw/esbuild) — MIT.
- [builtin-modules 3.3.0](https://github.com/sindresorhus/builtin-modules) — MIT.
- [TypeScript 5.9.3](https://github.com/microsoft/TypeScript) — Apache-2.0.
- [Obsidian API 1.13.1](https://github.com/obsidianmd/obsidian-api) — MIT; used as a type/API dependency and supplied by Obsidian at runtime.
- [@types/node 20.19.43](https://github.com/DefinitelyTyped/DefinitelyTyped) — MIT.

The plugin itself is licensed under [MIT](LICENSE). See each upstream project for its complete license text and copyright notices.
