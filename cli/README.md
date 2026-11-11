# rwv2 — запуск файлов

Консольное приложение (Node.js + Electron). 
окно **перетаскивается мышью** за любую точку и **масштабируется** за край / правый нижний угол
(а также `--scale`, `scale <n>`, Ctrl +/-).

## Использование

```bat
rwv2 run gter.sfc
rwv2 gter.gba --scale 3 --top
rwv2 run gter.snes --size 640x560 --pos 100,50
rwv2 run gter.gba -d              :: окно отдельно, консоль свободна

rwv2 keys                         :: показать раскладку
rwv2 bind a space                 :: A = Пробел
rwv2 bind b=z start=enter x=up    :: сразу несколько
rwv2 bind l                       :: назначить следующую нажатую клавишу
rwv2 swap a b
rwv2 unbind select
rwv2 keys reset
```

Пока запущено, в консоли доступно приглашение `rwv2>` с командами
`bind`, `pause`, `resume`, `reset`, `volume`, `scale`, `size`, `move`, `center`, `top`, `info`, `quit`.

Кнопки: `up down left right a b x y l r start select`.
Клавиши хранятся как коды (`KeyZ`, `ArrowUp`...), поэтому работают при любой раскладке (RU/EN).

Горячие клавиши в окне: **Ctrl+Q** выход, **Ctrl+P** пауза, **Ctrl+R** сброс,
**Ctrl +/-** масштаб, **Ctrl+T** поверх окон.

Конфиг: `%APPDATA%\rwv2\config.json` (раскладка, громкость, положение и масштаб окна).

## Устройство

- `bin/rwv2.js` — консольный лаунчер (чистый Node, без зависимостей) и REPL;
- `electron/` — безрамочное окно; `renderer/player.js` обрабатывает клавиатуру;
- `lib/` — раскладки, конфиг, локальный сервер для EmulatorJS;
- веб-версия в корне проекта (`src/`) — упрощённый адаптер того же интерфейса в браузере.
