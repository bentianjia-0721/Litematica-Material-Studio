# Litematica Material Studio

一个在浏览器本地解析 `.litematic` 文件、识别 Minecraft Java Edition 版本并生成材料清单与 Excel 的静态 Web 应用。

> `test` 分支的独立实验入口是 <https://litematica.bentianjia.com/test/>；生产入口 <https://litematica.bentianjia.com/> 仍由 `main` 分支提供。

> 当前版本适合检查受支持版本的数据和常见原版方块材料，不应视为“所有 Litematica / Minecraft 历史版本均已完整验证”的转换器。准确的数据覆盖与限制见[支持状态](#支持状态)和[已知限制](#已知限制)。

## 功能

- 拖拽、点击或键盘选择 `.litematic` 文件，上传入口限制为 128 MiB。
- 使用 Web Worker 在浏览器内完成 gzip 解压、NBT 解析、版本识别和材料统计，可取消正在进行的任务。
- `test` 分支使用内置 Minecraft 1.21.11 纹理与方块状态模型提供预览：鼠标旋转、缩放和平移，并可切换全部、单层或连续多层显示。
- 预览提供默认关闭的“启用 XK 红显”开关；开启后按原理图中的完整方块状态优先套用 XK 红显 v3.3，缺失、损坏或不匹配的状态逐项回退原版 1.21.11，最后才使用彩色占位。
- NBT 解析支持全部标准 Tag、Java 有符号 `Long` / `LongArray`、BigInt，以及深度、长度、总 Tag 数和解压体积限制。
- 读取 Metadata、多 Region、Position、正负 Size、方块状态调色板和位压缩 `BlockStates`；支持跨 64 位 Long 边界的条目。
- 只按投影内的 `MinecraftDataVersion` / `DataVersion` 自动识别版本；没有精确本地数据时自动选取同一版本系列中最近的数据并明确标记兼容推断，不提供手动切换，也不会静默套用最新版本。
- 按 Litematica 的 Pick Block 材料逻辑转换方块：忽略传送门、活塞头、气泡柱等无建造物品的技术方块，仅统计源流体，并处理门/床/双层植物、盆栽、多面方块、双层台阶、蜡烛、雪层、海泡菜等特殊状态。
- 材料清单始终按投影自动识别出的版本加载对应物品名、堆叠上限与方块到物品映射。
- 材料清单使用构建期从 Minecraft Wiki 下载并内容哈希去重的 `Invicon` 物品栏图标；缺少图标时才回退统一占位图。
- 未知或 Mod 命名空间不会被静默丢弃；保留原始 ID，并标记未知堆叠上限或转换警告。
- 检测到 Mod 材料时可导入本机模组 `.jar` 或资源包 `.zip`，在浏览器内读取标准 `zh_cn` / `en_us` 语言文件、物品模型和 PNG 纹理，补全当前投影用到的模组物品名称与图标。
- 材料表支持搜索、状态筛选、排序、每页 50 项、编辑“总共需要 / 已经拥有 / 剩余需要”、批量完成/清零与撤销。
- 按文件内容哈希保存本地进度；再次选择同一文件时恢复已有数量，版本仍由投影内容重新自动识别。
- 导出 `.xlsx`：包含“材料清单”和“投影信息”两个工作表、堆叠拆分、完成度公式、筛选、冻结表头、数据校验和未知材料提示。
- 响应式中文界面，并提供上传、输入、分页和状态提示所需的基础无障碍语义。

## 架构

```text
File API
  └─ App / UploadPanel
      ├─ 内容哈希与本地进度
      └─ Web Worker
          ├─ pako gzip
          ├─ 安全 NBT + Litematic Region / BlockStates
          ├─ DataVersion / 格式版本匹配
          ├─ 按需加载版本化物品 JSON
          └─ BlockState → Item → 材料聚合
              ├─ React 材料表与进度编辑
              └─ ExcelJS 浏览器端导出
```

主要目录：

| 路径                                  | 职责                                                         |
| ------------------------------------- | ------------------------------------------------------------ |
| `src/lib/litematic/`                  | gzip、完整 NBT、Long 位数组、Region 与元数据解析             |
| `src/workers/`                        | 解析流水线、进度消息、取消和错误回传                         |
| `src/lib/minecraft-data/`             | 版本索引、按需 JSON 加载、DataVersion/格式兼容匹配           |
| `src/lib/materials/`                  | 方块状态归一化、方块到物品映射、特殊状态倍数与警告           |
| `src/lib/mod-resources/`              | 本地 Mod JAR / 资源包语言、模型与纹理解析                    |
| `src/lib/stack/`、`src/lib/progress/` | 堆叠拆分和可复用进度计算                                     |
| `src/lib/storage/`                    | 文件哈希，以及 IndexedDB → localStorage → 内存的可复用存储层 |
| `src/lib/excel/`                      | Excel 工作簿、公式、样式、校验与下载                         |
| `src/features/schematic-preview/`     | 内置 1.21.11 资源按需读取、方块模型烘焙、分层预览与视角控制  |
| `public/resource-packs/`              | 原样提供的可选 XK 红显 v3.3 预览覆盖包                       |
| `src/features/`                       | 上传、进度、投影摘要和材料表 UI                              |
| `cloudflare/`                         | `/test` 到 Pages Preview 分支别名的 Worker 路由              |
| `src/data/minecraft/`                 | 本地版本数据、DataVersion 映射、兼容矩阵和生成报告           |
| `scripts/`                            | 版本研究、Minecraft 数据生成和一致性验证                     |
| `tests/`                              | 解析、真实格式生成夹具、材料/UI 与 Excel 测试                |

当前 UI 直接用 `localStorage` 保存哈希对应的简化进度；`src/lib/storage/project-storage.ts` 提供的 IndexedDB 降级链是独立可复用模块，尚未替换这条 UI 存储路径。

## 本地开发、检查与构建

要求 Node.js 20 或更高版本。推荐从锁文件安装依赖：

Windows 用户可直接双击根目录的 `start-local.cmd`；它会在首次运行时安装依赖、启动 Vite，并打开 <http://127.0.0.1:5173/>。不要直接双击 `index.html` 或 `dist/index.html`，ES module、Web Worker 和按需资源需要通过 HTTP 本地服务器加载。

```bash
npm ci
npm run dev
```

常用命令：

```bash
npm run typecheck       # 严格 TypeScript 检查
npm run lint            # ESLint，禁止 warning
npm test                # Vitest 单次运行
npm run test:watch      # Vitest 监听模式
npm run format:check    # 检查 Prettier 格式
npm run format          # 写入 Prettier 格式
npm run build           # typecheck 后由 Vite 构建到 dist/
npm run preview         # 本地预览 dist/
npm run build:test      # 以 /test/ 为 base 构建到 dist-test/
npm run preview:test    # 在 /test/ 下本地预览 dist-test/
```

`npm run build` 不会自动执行 ESLint 或 Vitest；发布前建议依次运行 `typecheck`、`lint`、`test`、`format:check` 和 `build`。

测试重点包括：有效/损坏 gzip、全部标准 NBT Tag、BigInt Long、恶意长度和深度限制、单/多 Region、负尺寸、非 2 次幂调色板、跨 Long 位打包、空气保留、未知格式/命名空间、上传交互、材料表与 Excel 公式。

## `.litematic` 解析流程

1. 上传组件检查扩展名、空文件和 128 MiB 文件上限。
2. 主线程读取 `ArrayBuffer`，计算 SHA-256（不可用时回退 FNV-1a 64）作为本地进度键，然后把缓冲区转移给 Worker。
3. pako 流式解压 gzip；默认同时限制压缩输入和解压输出。
4. 以大端序读取 NBT。Compound 使用无原型对象并拒绝重复键，集合、字符串、深度、总 Tag 数和输入字节数均有限制。
5. 读取根级格式版本、子版本和 Minecraft DataVersion，再读取 Metadata 与全部 Regions。
6. Region Size 的每个轴取绝对值计算体积；调色板索引按 Litematica 连续位数组解码，支持一个条目横跨两个有符号 Long。
7. 按 `x → z → y` 索引顺序，从 Region 最小角生成全局预览坐标；有符号 Size 只用于推导边界，预览只略过三种空气，传送门、流体和技术方块仍可见。
8. 聚合各 Region 的完整方块状态。解析层保留空气，材料层再统一过滤 `air`、`cave_air` 和 `void_air`。
9. 材料层应用与 Litematica 一致的 Pick Block、空物品栈过滤、状态倍数和最大堆叠数量；未知 Mod 项保留原始 ID 与警告。

默认安全上限包括 128 MiB 上传、512 MiB 解压 NBT、单 Region 50,000,000 个位置、全部 Region 合计 100,000,000 个位置，以及最多保留 200,000 个非空气体素用于 3D 预览。它们是浏览器安全边界，不是格式能力声明；预览截断不影响完整材料统计与 Region 边界。

## 版本识别

当前实现的自动匹配顺序为：

1. 精确匹配 DataVersion；若精确记录对应本地数据，则加载该版本。
2. 能精确识别投影版本、但没有该补丁版本的本地数据时，自动加载同一 Minecraft 版本系列中 DataVersion 最近的本地数据，并标记为兼容推断。
3. 没有精确记录时，仅在 DataVersion 距离不超过 64、且属于同一 Minecraft 主数据系列时自动选择最近的本地数据。
4. 缺少 DataVersion 时可使用 Metadata 中的明确 Minecraft 版本，并按相同规则自动加载精确或同系列数据。
5. Litematic 格式版本本身不足以确定 Minecraft 版本，只用于给出诊断候选；页面不提供手动版本切换，也不会自动套用最新版本。

每个版本 JSON 通过 `import.meta.glob` 按需加载；页面不会一次性解析全部版本数据。

## 支持状态

以下数字直接来自仓库当前两份生成报告，并由当前验证报告补充检查；它们不是市场宣传意义上的全历史兼容承诺：

- [`minecraft-data-report.json`](src/data/minecraft/reports/minecraft-data-report.json)，生成于 `2026-07-16T13:43:18.735Z`
- [`litematica-version-report.json`](src/data/minecraft/reports/litematica-version-report.json)，生成于 `2026-07-16T12:29:08.896Z`
- [`version-data-validation-report.json`](src/data/minecraft/reports/version-data-validation-report.json)，生成于 `2026-07-16T13:47:50.669Z`

### 本地 Minecraft 物品数据

当前仅有 **17 个**精确版本数据文件：

```text
1.12.2, 1.13.2, 1.14.4, 1.15.2, 1.16.5, 1.17.1, 1.18.2,
1.19.2, 1.19.4, 1.20.1, 1.20.4, 1.20.6, 1.21.1, 1.21.4,
1.21.5, 1.21.8, 1.21.11
```

这 17 个条目在 `versions.json` 中均标为 `partially-supported`。报告累计包含：

| 指标                           |   数量 |
| ------------------------------ | -----: |
| 本地版本文件                   |     17 |
| 物品记录（跨版本累计，非去重） | 19,444 |
| 有 zh-CN 名称的物品记录        | 19,412 |
| 缺少 zh-CN 名称的物品记录      |     32 |
| 方块记录（跨版本累计，非去重） | 15,349 |
| DataVersion 映射记录           |    820 |
| 有 Wiki 图标的物品记录         | 19,125 |
| 缺少图标、使用占位图的记录     |    319 |
| 内容哈希去重后的 PNG / GIF     |  1,424 |

数据由 `minecraft-data@3.111.0` 生成。17/17 个本地版本均成功载入对应的 Mojang `zh_cn` 语言资产，人工整理名称仅作补充回退；当前中文名缺失率为 **0.16%**（32 / 19,444）。中文覆盖仍不是 100%，旧版本歧义名称和变体 metadata 也可能无法可靠关联语言键，因此继续保留英文名称和原始 ID 回退。

当前验证报告为 `valid: true`、无 errors/warnings；方块到物品映射缺失率仍为 **2.25%**（345 / 15,349），这些方块不能被宣传为已可靠完成材料转换。

### Litematica 兼容研究矩阵

当前研究报告记录了 **479** 个 Litematica 发布记录、**508** 条“Litematica 发布版本 × Minecraft 版本”关系、**79** 个 Minecraft 版本/快照标签和 **22** 个有记录的 DataVersion 值。508 条关系的状态为：

| 矩阵状态              | 关系条目数 |
| --------------------- | ---------: |
| `fully-supported`     |          0 |
| `partially-supported` |        343 |
| `unverified`          |        162 |
| `unsupported`         |          3 |
| 合计                  |        508 |

当前 **`fully-supported = 0`**：仓库尚未纳入可重复测试、许可证允许分发、并能对应到具体发行族的真实 `.litematic` 样本，因此不会仅凭本地数据、DataVersion 和源码格式常量把关系提升为完整支持。343 条关系只有部分数据或格式证据，仍标为部分支持；3 条发布名称包含 `do-not-use` / `broken`，被明确标为不支持。`verified` 置信度描述某项版本关系证据，不等同于端到端 fully-supported。

报告当前列出的已验证格式版本集合为 **6、7**。解析器会结构性尝试默认列表中的格式 4–7，并对未知格式给出警告，但这不等于格式 4、5 或所有子版本都已有充分的真实文件回归覆盖。

## 材料数据、图标与许可证来源

### 数据来源

- Litematica 发布、格式与材料换算证据：[Masa / maruohon 的 Litematica 官方源码仓库](https://github.com/maruohon/litematica)（包括 `MaterialListUtils` / `MaterialCache`）与[原作者控制的 Modrinth 项目](https://modrinth.com/mod/litematica)。本项目与 Litematica、Masa 或 Mojang 无隶属关系。
- Minecraft 注册表、物品堆叠数量、方块和 DataVersion 基础数据：[PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data)，当前锁定生成版本为 `3.111.0`。
- 中文名称来自 Mojang 官方版本清单、各版本 asset index 和对应 `minecraft/lang/zh_cn` 资产；生成文件保留具体元数据、索引和资源 URL。语言资产无法匹配时才使用少量人工稳定名称，然后回退英文或 ID。
- 每个生成数据文件和兼容矩阵条目均保存来源 URL；研究置信度分为 `verified`、`cross-checked` 和 `inferred`。

### 图标状态

图标在运行 `npm run update:minecraft-data` 时通过 Minecraft Wiki MediaWiki API 查询 `Invicon <英文物品名>.png` 和 `.gif`，跟随 Wiki 文件重定向后下载到 `public/minecraft-icons/`。文件使用内容哈希命名并跨版本复用，不在网页运行时外链 Wiki。19,444 条跨版本物品记录中，19,125 条有 Wiki 图标映射；1,562 个唯一英文名称匹配 1,512 个，最终得到 1,395 个 PNG 和 29 个 GIF，共 1,424 个文件、约 4.1 MiB。浏览器只加载当前材料行可见的图片。

Wiki 图标包括普通 PNG、用于时钟/指南针/部分动态方块的 GIF，以及诸如 `Steak → Cooked Beef` 的文件重定向。每个成功匹配的物品记录保留具体 Wiki 文件页 URL。它们代表 Wiki 当前物品栏图标，不宣称为每个 Minecraft 历史补丁版本的逐像素快照；没有匹配图标的条目继续使用项目自制 CSS 像素占位图。

Minecraft Wiki 的文件页将这些游戏图标标记为 Mojang 内容；从 Wiki 下载到本项目并不会转移所有权或产生新的许可证。Minecraft 图像仍属于 Mojang / Microsoft；页面包含非官方项目声明，部署者仍须遵守 Minecraft EULA 与使用规范。

### 许可证

关键上游的声明如下；最终应以各依赖随包提供的许可证文件为准：

| 项目                                                                                   | 用途                   | 上游声明或适用条款                            |
| -------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------- |
| Litematica                                                                             | 格式与版本研究参考     | LGPL-3.0                                      |
| minecraft-data 3.111.0                                                                 | 生成版本化注册表数据   | MIT                                           |
| Mojang 版本化 zh-CN 语言资产                                                           | 中文名称               | Minecraft EULA / 使用规范                     |
| Minecraft Wiki Invicon                                                                 | 构建期物品栏图标       | 文件页标记为 Mojang 内容；适用 Minecraft 条款 |
| Minecraft 1.21.11 预览资源子集                                                         | TEST 版方块模型与纹理  | Minecraft EULA / 使用规范                     |
| [XK 红显 v3.3](https://www.planetminecraft.com/texture-pack/redstone-display-5793327/) | 可选红石状态显示覆盖包 | Xe_Kr，CC BY-NC-ND 4.0                        |
| React / React DOM                                                                      | UI                     | MIT                                           |
| pako                                                                                   | gzip                   | MIT AND Zlib                                  |
| ExcelJS                                                                                | `.xlsx` 生成           | MIT                                           |
| idb                                                                                    | IndexedDB 封装         | ISC                                           |
| JSZip                                                                                  | 本地 Mod ZIP/JAR 解析  | MIT                                           |
| zip.js                                                                                 | 内置预览 ZIP 按需读取  | BSD-3-Clause                                  |
| mc-assets                                                                              | 方块状态/模型解析器    | MIT                                           |
| Three.js                                                                               | 3D 模型预览            | MIT                                           |
| Vite / Vitest                                                                          | 构建与测试             | MIT                                           |
| Wrangler                                                                               | Cloudflare 部署工具    | MIT OR Apache-2.0                             |

Mojang / Microsoft 的语言内容不因 `minecraft-data` 的 MIT 许可证而变成 MIT 内容；使用与再分发时应另行遵守 [Minecraft EULA](https://www.minecraft.net/en-us/eula)和[Minecraft 使用规范](https://www.minecraft.net/en-us/usage-guidelines)。

仓库当前**没有项目级 `LICENSE` 文件**。在补充明确许可证前，不应仅凭上游依赖的许可证推断本项目自身的授权范围；重新分发时也应审阅 `package-lock.json` 中全部直接与传递依赖的许可证。

## 测试夹具来源

[`tests/fixtures/litematic-fixture.ts`](tests/fixtures/litematic-fixture.ts) 中的夹具由测试代码现场生成，不是从玩家、下载站或第三方投影复制：

- 生成 Java 大端序 NBT 和 modified UTF-8 字符串；
- 生成 Metadata、多个 Region、调色板、实体列表和 LongArray；
- 独立打包跨 Long 边界的方块状态索引；
- 最后使用 pako 生成 gzip，得到真实文件结构的二进制输入。

这些生成式夹具能稳定覆盖边界条件和恶意输入，但不能替代不同 Litematica / Minecraft 发布版本实际保存出的真实 `.litematic` 样本。仓库没有捆绑第三方用户建筑，当前真实样本的逐版本覆盖仍然不足。

## 隐私与本地数据

- 用户选择的 `.litematic` 内容由 File API 读取并转移到本地 Web Worker；应用代码不会把文件上传到 Cloudflare 或其他服务器。
- 用户选择的 Mod `.jar` / 资源包 `.zip` 同样只在当前浏览器页面内解压；不上传、不执行其中的代码，也不保存压缩包或解析出的图片。
- 解析、材料换算、进度计算和 Excel 生成均在浏览器内完成；运行时物品版本 JSON 从同一静态站点按需加载。
- TEST 版 3D 预览固定读取随站点部署的 `public/minecraft-assets/minecraft-1.21.11-preview.zip`；页面启动后会在后台预加载一次，上传投影后复用浏览器缓存，不会在运行时访问 Mojang 版本清单或客户端地址。
- XK 红显默认关闭；只有用户打开开关时才读取同源的 XK 红显 v3.3 ZIP。该 ZIP 按作者的 CC BY-NC-ND 4.0 条款原样提供，未改动包内文件。
- 当前 UI 只在 `localStorage` 保存文件内容哈希、文件名、已拥有数量、手动堆叠上限和时间戳，不保存版本选择或原始投影二进制。
- 清除站点数据、使用隐私模式或更换浏览器会丢失本地进度；页面没有账号、云同步或多人协作。
- `public/_headers` 的 CSP 只允许同源连接，并禁止嵌入和摄像头/麦克风/定位等权限。托管平台仍会像任何静态网站一样接收正常的页面与资源 HTTP 请求，这与上传投影文件是两回事。

## Cloudflare Pages Direct Upload

该项目是纯静态 Vite 构建，没有 Pages Functions。生产 Vite 输出目录是 `dist/`；`public/_headers` 和 `public/_redirects` 会复制到构建结果，用于安全响应头、长期静态资源缓存和 SPA 回退。`test` 分支另有 `dist-test/` 构建和 `wrangler.test-router.jsonc`，只接管自定义域的 `/test*` 路由。

当前生产项目为 `litematica-material-studio`，生产分支为 `main`，正式地址是 <https://litematica.bentianjia.com/>，`pages.dev` 地址仅作为托管平台回退入口。自定义域名当前已通过 Cloudflare Pages 验证，DNS 与 SSL 状态均为 `active`。

先完成本地验证和构建：

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

然后使用仓库中已安装的 Wrangler：

```bash
npx wrangler login
npx wrangler pages project list
```

如果要在另一个 Cloudflare 账号重新创建项目，运行：

```bash
npx wrangler pages project create litematica-material-studio --production-branch main
```

重新部署当前生产项目：

```bash
npx wrangler pages deploy dist --project-name litematica-material-studio --branch main
```

`test` 分支先构建并作为 Pages Preview 部署，再发布路径 Worker：

```bash
npm run build:test
npx wrangler pages deploy dist-test --project-name=litematica-material-studio --branch=test
npx wrangler deploy --config wrangler.test-router.jsonc
```

该 Preview 的稳定源站别名是 `test.litematica-material-studio.pages.dev`。Worker 只为 `/test` 做尾斜杠跳转，并把 `/test/…` 去前缀后转发到该别名；生产根路径不会进入 Worker。

部署后至少实测：首页和静态资源、拖拽/选择、Worker、真实 `.litematic`、版本识别、材料编辑、本地进度与 Excel 下载。

Cloudflare 当前文档说明 Direct Upload 项目创建后不能原地切换为 Git integration；如果之后要改用 Git 自动部署，需要新建对应项目。命令与限制以 [Cloudflare Pages Direct Upload 官方文档](https://developers.cloudflare.com/pages/get-started/direct-upload/)为准。

## 已知限制

- 正式入口只接受 `.litematic`；不支持旧 `.schematic`、Sponge `.schem` 或结构方块 `.nbt`。
- 只有上述 17 个本地 Minecraft 数据版本；其他精确版本会优先自动使用同系列最近数据并标为兼容推断，无法建立可靠同系列关系时才保留原始方块 ID。
- 当前研究矩阵出现的 `26.1`、`26.1.1`、`26.1.2`、`26.2` 均没有 `minecraft-data@3.111.0` 的精确本地物品数据，不能输出有版本依据的完整材料清单。
- 中文名覆盖为 19,412 / 19,444（缺失 0.16%），仍不完整；英文名称和 Minecraft ID 是必要回退。Wiki 图标覆盖为 19,125 / 19,444（98.36%）；这些是 Wiki 当前 Invicon，不是全部历史补丁版本的逐像素归档。
- 兼容矩阵含推断条目，报告明确指出旧 Modrinth 导入记录的发布日期可能不是原始发布日期，分支格式常量也不能证明该版本的每个发布包都写出相同子版本。
- 真实 Litematica 生成样本覆盖不足；测试以生成式 gzip NBT 夹具为主，不能据此宣称全历史兼容。
- 材料转换规则不是完整 Minecraft 模拟：容器内容、方块实体库存、实体、掉落概率、红石/流体更新、相邻方块合并和资源复用不会被完整推演。
- 多 Region 按各自内容求和；重叠 Region 不做空间去重，可能导致重叠位置重复计数。
- TEST 版 3D 功能还原对应版本的标准 blockstate `variants` / `multipart`、模型继承、元素、朝向、UV、透明纹理和 tint；需要客户端代码或方块实体数据的动态特效，以及非标准 Mod model loader 会明确降级。超出 200,000 个非空气方块时仍使用确定性蓄水池保留代表性位置。
- 3D 预览当前只显示方块，不解析或渲染原理图 `Entities` 中的生物、盔甲架、物品展示框等实体。
- Mod 方块会保留 ID；导入包含标准资源目录的 Mod JAR / 资源包后可补全当前材料的名称和 PNG 图标，但应用不会执行 Mod 代码，也无法从静态资源可靠推断方块到物品的非标准转换或运行时最大堆叠数量，后者需手动填写。
- 导入的 Mod 名称与图标只保留在当前页面会话中；刷新页面、重置项目或重新打开投影后需要重新导入资源。
- 大文件同时受上传、解压 NBT、集合长度和 Region 体积限制；在低内存移动设备上仍可能失败。
- 时间戳仅按合理量级在秒和毫秒之间判断；异常或非标准时间字段可能显示为未知。
- 本地进度不包含原始投影文件，也不会跨设备同步。
- 项目尚无自身许可证文件。

## 更新 Minecraft / Litematica 版本数据

更新前先确认目标 `minecraft-data` 版本及上游许可证。若需要升级依赖：

```bash
npm install --save-dev minecraft-data@<已核实版本>
```

新增本地 Minecraft 版本时，还必须修改 `scripts/update-minecraft-data.ts` 中的 `TARGET_VERSIONS`；生成器要求上游提供精确版本，不接受静默别名。推荐顺序：

```bash
npm run update:minecraft-data
npm run generate:minecraft-preview-assets
npm run research:litematica-versions
npm run validate:version-data
npm run typecheck
npm run lint
npm test
npm run build
```

- `update:minecraft-data` 联网读取 Mojang 版本清单、各版本 `zh_cn` 语言资产，以及 Minecraft Wiki Invicon 文件元数据和图片；随后重建 17 个（或修改后的目标集合）版本 JSON、图标目录、`versions.json`、`data-version-map.json` 和 Minecraft 数据报告。必须同时检查 `localization.updateWarnings` 与 `iconData.downloadWarnings`。
- `generate:minecraft-preview-assets` 下载固定的 Minecraft 1.21.11 客户端，严格校验 SHA-1 `ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd`，再确定性生成仅含 blockstates、block models、block/colormap 纹理及模型引用 item 纹理的同源预览 ZIP 和 SHA-256 清单。该资源包含 Mojang / Microsoft 内容，重新生成或部署前必须审阅 Minecraft EULA 与使用规范。
- `research:litematica-versions` 联网读取原作者 Modrinth 发布记录、官方 Git refs 和选定源码证据，重建兼容矩阵与研究报告。网络失败时脚本可能保留已有矩阵，因此必须检查报告 `generatedAt`、`errors` 和实际 diff，不能只看进程退出码。
- `validate:version-data` 检查文件、DataVersion、来源 URL、最大堆叠数量和 fully-supported 条件，并生成 `version-data-validation-report.json`。

任何支持状态提升都应同时附上源码/发布来源、真实 `.litematic` 样本和回归测试；不要仅根据版本名称相近就标为完整支持。
