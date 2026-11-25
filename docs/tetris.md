# 毛绒俄罗斯方块

## 本地启动与验收

使用 Bun 1.4.2、Node.js 22.12+、Rust 1.99.0 和 `wasm-pack` 0.15.1。Rust 版本与 WASM 目标由根目录的 `rust-toolchain.toml` 固定。Windows 的 Rust 原生测试还需 Visual Studio C++ 生成工具。

```sh
rustup toolchain install 1.99.0 --profile minimal --target wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.1 --locked
bun install --frozen-lockfile
bun run dev
```

开发时打开 [游戏大厅](http://localhost:5173/) 或 [毛绒俄罗斯方块](http://localhost:5173/tetris)。生产验收使用单独的本地端口，方便和已有预览同时运行。

```sh
bun run build
bun run preview --host 127.0.0.1 --port 45371 --strictPort
```

1. 打开[生产预览大厅](http://127.0.0.1:45371/)，转动球形菜单找到「毛绒俄罗斯方块」。确认毛绒封面、名称和介绍同步变化，点击卡片或圆形箭头进入。
2. 在开始画面选休闲、标准或挑战，再点「开始游戏」。用 `←`、`→` 移动，`↑` 或 `X` 顺转，`Z` 逆转，`↓` 或 `Space` 直接落到底，`S` 软降，`C` 或 `Shift` 暂存。手机用棋盘下方的「落到底」按钮。长按左右和软降会重复，直接落到底和旋转每次按键只执行一次。
3. 拼满一行，观察计分和消行。用 `P`、`Esc` 或暂停按钮暂停，确认计时停住。打开设置可以切换「重力加速下落」、画质、落点预览、音效和减少动态效果。关闭设置后确认原来的暂停状态仍在，再点继续。
4. 游玩时切到另一标签页再切回，确认要手动继续。刷新后，检查棋盘、分数、暂存和接下来的五块从暂停状态恢复。继续玩到结束，在「查看记录」中确认成绩，刷新后记录仍只有一份。
5. 点「返回游戏大厅」。直接打开 [游戏地址](http://127.0.0.1:45371/tetris)，确认可访问并可刷新。`/tetris` 会以 308 转到 `/tetris/`，查询参数会保留。大厅中原来的五个游戏入口仍可进入。

## 规则与实现

- 10 × 20 可见棋盘，另外有 4 行隐藏生成区。每袋七种方块各一个，场外显示后续五块。`Game::new(seed)` 及 `tetris_new(seed)` 可用于固定种子的复现和测试。
- 可旋转时采用 SRS 踢墙。活动块与已落定的格子共享一条边时，会暂停横移、旋转、软降、硬降和暂存。沿侧面自然下落并离开接触后可继续操作。落在堆叠上时由锁定计时完成放置。`tetris-engine/src/srs.rs` 分别定义占格、旋转状态、JLSTZ 与 I 踢墙表。[SRS 旋转与踢墙表](https://tetris.wiki/Super_Rotation_System)
- 每 10 行升一级。自然下落默认匀速。开启「重力加速下落」后，正常下落从静止开始连续加速。切换会应用到当前对局并接续当前下落位置。一级的速度按官方《俄罗斯方块》网页版三个等级校准。触底时提供 500 ms 锁定时间。仅接触地板时，合法横移或旋转至多刷新 15 次，离开地板时保留倒计时。硬降可用时按下会立即锁定。每个方块锁定前可以暂存一次。[官方网页版](https://play.tetris.com/play-now) · [官方游戏的速度参数](https://play.tetris.com/tetris-game-package/game/target-desktop/assets/main/index.js)
- 一次消除 1、2、3、4 行分别得 100、300、500、800 分，再乘消行之前的等级。主动软降每格加 1，硬降每格加 2。自然下落只推进位置。锁定先结算消行，之后隐藏区仍有锁定格、或新块无法生成时结束。
- Rust 保存棋盘、活动方块、后续队列与随机状态、暂存、统计及重力和锁定计时，并校验恢复数据。浏览器以 `plush-tetris.*.v1` 保存对局、设置和历史。游玩中按秒保存，暂停或离开页面时同步保存。已结束对局按 ID 去重。积木的编号随落定格保存并随消行下移，用于区分邻接的同色积木。旧存档里的格子会分配独立编号。
- R3F 将每组占格绘制成一个连体软垫，表面有成簇、带走向的绒毛和不均匀的鼓起。自然下落用 Rust 的飞行时间、每格间隔或加速度逐帧计算位置。硬降用更大的加速度跑完剩余距离。变形幅度由着地速度决定。触地时接触处先凹陷，偏离支撑的一端会回摆。被压到的方块也会下陷并回弹，再把较弱的振动传给下面一层。触发消行时，满行在首次回弹后收缩散绒，上方方块加速落入结算后的格子。Rust 即时更新得分和棋盘，动画从这些结果取数据。
- 一个 WebGL 场景按需绘制，形状相同的实例共享几何和材质。画质调节纤维密度和分辨率。暂存、预览、兼容棋盘和大厅封面由游戏内同一套 Three.js 模型生成。音效由 Web Audio 合成。设置沿用已有 React Bits Squish Switch 并传入本游戏的主题色和减少动态效果配置，常用控件采用 daisyUI。[Squish Switch](https://reactbits.dev/micro/squish-switch) · [React Bits 许可证](../public/licenses/REACT-BITS.txt)

| 本游戏难度 | 官方网页版参考等级 | 官方每格间隔 | 本游戏一级自然下落 20 格 |
| --- | ---: | ---: | ---: |
| 休闲 | 7 | 190 ms | 3.80 秒 |
| 标准 | 9 | 94 ms | 1.88 秒 |
| 挑战 | 11 | 43 ms | 0.86 秒 |

三档以官方固定间隔通过 20 格的总时间为基准。匀速和重力加速使用相同的基准时长。设置中的「下局难度」在新局生效，刷新后恢复中的对局沿用开局难度。

## 构建与发布

`bun run build:wasm:tetris` 可独立编译方块核心。它运行 `cargo build --locked --release --manifest-path tetris-engine/Cargo.toml --target wasm32-unknown-unknown --target-dir tetris-engine/target` 并将 `tetris_core.wasm` 复制至 `src/generated/tetris/`。全站的 `bun run dev` 和 `bun run build` 均包含这个步骤。Vite 将 WASM、预览贴图、JS 和 CSS 以带内容哈希的文件名写到 `dist/assets/`，独立页面为 `dist/tetris/index.html`。

Vercel 项目 `voidfield-minesweeper` 连接 GitHub 仓库 `Getaway-Wuji/MineSweeper`，生产分支为 `main`。上传提交后，在 Vercel 从该提交创建生产部署。

现有 `vercel.json` 调用 `scripts/build-vercel.sh`，安装锁定的 Bun、Rust 和 `wasm-pack`，从源码生成 `dist/`。该配置已增加 `/tetris` 重定向、`/tetris/` 页面映射，并沿用 `/assets/*.wasm` 的 `application/wasm` 响应类型。发布后用[正式游戏地址](https://game.grace-spring.top/tetris)复验大厅往返、直接访问、刷新恢复及原有入口。

## 自动化测试

```sh
bun run test:rust:tetris
bun test src/tetris/engine src/tetris/render
bun run test:browser tests/tetris.spec.ts tests/tetris-input.spec.ts tests/tetris-render.spec.ts
bun run test:browser tests/hub.spec.ts -g "Plush Tetris"
```

浏览器测试默认在 4173 启动预览。如果已用 45371 启动预览，设置 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:45371`，PowerShell 可用 `$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:45371'`。

## 本地验证记录

- Windows 11、Bun 1.4.2 和 Rust 1.99.0 下验证了锁定安装、开发启动、生产构建和本地预览。生产预览以 `application/wasm` 提供方块核心，带查询参数的 `/tetris` 正常跳转到 `/tetris/`。
- 通过 32 项 Rust 核心测试和 29 项前端单元测试。Chrome 157 的生产预览测试覆盖难度选择、匀速下落、局内切换重力加速、贴住堆叠时拦截手动操作、侧碰时继续自然下落、按 ↓ 直接锁定、3D 回弹、支撑方块受压复位、键盘、触控取消、后台暂停、恢复、四行消除和记录去重，以及大厅的圆形箭头和卡片入口。已有扫雷、liquid2048、蛇域进化、玻璃汉诺塔和险阶对弈的页面入口也完成了本地回归。
- Intel Graphics（ANGLE D3D11）的 Chrome 上检查了单格、完整四格形状，以及含 179 个可见占格的高画质和低画质场景。密集场景连续提交移动和四组消行反馈期间未出现 WebGL 错误。另在生产棋盘实测四行消除，画面依次经过落地、收缩散开和清空，累计行数从 9 变为 13，等级从 1 变为 2。
- 手机布局及触控用 Chrome 模拟 Pixel 7 与 iPhone 13 检查。实体手机、Vercel 云端构建和正式地址留待验收和发布阶段。仓库原有 `sobosuba-engine` Rust 测试存在字段和构造函数不匹配的编译错误，全站 `test:rust` 会在这里中断，方块核心通过独立命令验证。
