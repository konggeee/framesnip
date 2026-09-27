# 拆帧大师 FrameSnip

视频转序列帧动画一站式工具：在浏览器中完成 **帧提取 → 编辑整理 → 多格式导出** 的完整流程。全部解码与编码均在本地浏览器完成，素材不上传。

> 参考了 framepacker.cn 的产品功能设计，代码为从零原创实现，仅用于学习交流。
> Made with ❤️ by **good**

## 快速开始

```bash
npm install
npm run dev        # 开发模式 http://127.0.0.1:5180
npm run build      # 生产构建到 dist/
npm run preview    # 预览构建版本
```

没有素材？在步骤 1 点击「载入演示视频」即可生成一段演示 WebM 体验完整流程。

## 功能清单

### 步骤 1 · 帧提取
- 导入：MP4 / MOV / WebM 视频、JPG / PNG / WebP 图片、GIF 动图、ZIP 图片压缩包；支持拖拽
- 视频预览播放器（播放 / 进度拖动）
- 抽帧方式：按帧率 / 按间隔 / 按帧数 / 全部帧，可设起止时间，单次上限 1200 帧保护内存
- **提取区间选择条**：在播放器下方拖动高亮区间（两端手柄微调、中部整体拖动），与右侧「起始时间 / 结束时间」双向联动；也可播放到任意位置点「设为起点 / 设为终点」
- 双解码引擎：MP4 优先走 **mp4box.js 解封装 + WebCodecs 硬解**，失败自动回退**浏览器 seek 解码**（兼容一切浏览器可播放格式）
- 精灵图导入切分：行列数、行/列优先、裁剪透明边缘、透明阈值，实时预览
- **保存工程**：生成自包含 `.fp.html`，双击即可在本工具中恢复全部帧与设置

### 步骤 2 · 编辑与整理
- 帧网格：拖拽排序（**sortablejs**）、单击选中 / Ctrl 多选 / Shift 范围选、双击进编辑器
- 批量操作：全选 / 反选 / 删除 / 复制 / 反转顺序 / 旋转 90° / 水平垂直镜像 / 裁剪到选中 / 清空
- **智能去重**：32×32 缩略采样比较相邻帧差异，阈值可调，先分析预览再应用
- **循环查找**：自动搜索首尾衔接最平滑的子区间，给出 3 个候选（周期 / 平滑度评分）、循环预览、一键裁剪
- 预览播放器：帧率 1–60 fps、循环开关、逐帧步进、时长显示

### 帧编辑器（双击帧打开）
- 工具：画笔（大小 / 硬度 / 不透明度）、橡皮、油漆桶（容差）、吸管（取色历史）、魔棒（容差 / 连续 / 变透明或换色）、**去水印笔**（快捷键 W）
- 视图：滚轮缩放（≥3x 自动像素化）、空格拖动平移、适应窗口 / 1:1、棋盘格透明底
- 智能面板（支持**一键应用到全部帧**）：
  - **色键抠图**：目标色取样、容差、despill 去绿边强度
  - **换色**：目标色 / 替换色 / 容差 / 保留明暗
  - **Alpha 阈值**：双阈值把半透明边缘二值化
  - **去水印**：用水印笔涂抹水印 / 台标区域（红色叠加显示），Telea 快速行进算法（`cv2.inpaint` 同源）在 Web Worker 中按周围画面智能修复，不卡界面；涂抹位置固定时可一次应用到全部帧
  - **智能抠图**：内置 MediaPipe 人像分割模型（本地自托管、全程离线，首次加载约 12MB 后浏览器缓存），一键把人物单独抠出、背景变透明，支持反选保留背景与边缘羽化
- 撤销 / 重做（20 步）、帧间导航、完整快捷键（按 `?` 查看）

### 步骤 3 · 导出
| 格式 | 说明 | 引擎 |
|---|---|---|
| GIF | 循环 / 透明阈值 / 颜色数 16–256 / 逐帧调色板高质量模式 | gifenc |
| APNG | 全彩无损透明动图 | upng-js |
| PNG 序列 | 前缀 / 序号位数自定义，ZIP 打包 | jszip |
| 精灵图 | 列数自动或指定 / 帧间距 / 背景色，帧边界预览 | 内置合成 |
| WebM | VP9/VP8 编码，可保留透明 | WebCodecs + webm-muxer |
| MP4 | H.264 编码（真实 MP4 容器），无透明需填充背景色 | WebCodecs + mp4-muxer |

- 通用设置：分辨率（原图 / 1/2 / 2x / 自定义 + 锁比例）、适配方式（适应留边 / 填充裁剪 / 拉伸）、背景填充
- 导出预览播放、**体积估算**（按样本帧推算）、进度与取消
- 无 WebCodecs 的环境自动回退 MediaRecorder 实时录制

## 目录结构

```
src/
├── App.vue                  # 外壳：头部 / 提示条 / 三步卡片 / 页脚 / 全局弹层
├── main.js                  # 入口（含 DEV 测试钩子 window.__ff，构建时不打包）
├── core/
│   ├── state.js             # 响应式全局状态、toast、confirm
│   ├── importer.js          # 视频 seek 解码 / mp4box+WebCodecs / GIF / ZIP / 精灵图切分 / 演示视频
│   ├── dedupe.js            # 智能去重
│   ├── loopfinder.js        # 循环查找
│   ├── imageops.js          # 旋转 / 翻转 / 适配布局
│   ├── project.js           # .fp.html 工程序列化 / 恢复
│   └── encode/              # gif / apng / zip / sheet / video 各格式编码器
└── components/              # StepImport / StepEdit / StepExport / FrameGrid /
                             # PreviewPlayer / FrameEditor / LoopFinder / SheetSplitDialog …
```

## 部署

纯静态应用、无后端：`npm run build` 后把 **整个 `dist/` 目录**（含 `mediapipe/` 模型文件）放到任意静态文件服务器即可。

```bash
npm run build
# 方式一：Caddy（Windows/Linux 通用，单文件）
#   Caddyfile:  :8080 { root * /path/to/dist ; file_server }
# 方式二：Docker
docker build -t framesnip . && docker run -d -p 8080:80 framesnip
```

注意事项：
- 必须 HTTP(S) 访问，不能直接双击 `dist/index.html`（ES Module / Worker 限制）
- 建议配置 HTTPS（如 Caddy + 域名自动证书）；非安全上下文下 WebCodecs 快速解码不可用，会自动回退兼容解码
- 内存建议 ≥ 8GB（视频解码 / 编码均在浏览器端进行）

## 开源依赖致谢

本项目使用了以下优秀的开源项目（一并感谢原站选型带来的启发）：

| 项目 | 许可证 | 用途 |
|---|---|---|
| [Vue 3](https://github.com/vuejs/core) | MIT | UI 框架 |
| [Vite](https://github.com/vitejs/vite) | MIT | 构建工具 |
| [sortablejs](https://github.com/SortableJS/Sortable) | MIT | 帧网格拖拽排序 |
| [mp4box.js](https://github.com/gpac/mp4box.js) | BSD-3-Clause | MP4 解封装 |
| [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | MIT | MP4 封装导出 |
| [webm-muxer](https://github.com/Vanilagy/webm-muxer) | MIT | WebM 封装导出 |
| [gifenc](https://github.com/mattdesl/gifenc) | MIT | GIF 编码 |
| [upng-js](https://github.com/photopea/UPNG.js) | MIT | APNG 编码 |
| [jszip](https://github.com/Stuk/jszip) | MIT OR GPL-3.0 | ZIP 打包与解包 |
| [MediaPipe Selfie Segmentation](https://developers.google.com/mediapipe) | Apache-2.0 | 智能抠图人像分割模型（本地自托管） |

各依赖的完整许可证文本见 `node_modules/<包名>/LICENSE`。

## 与原站的已知差异

- 未复刻：账号 / 付费体系、多语言、曲线编辑器、对比导入、放大镜 loupe、套索 / 矩形椭圆选区
- 简化实现：循环查找（启发式评分）、GIF 抖动（未做误差扩散）、APNG 循环次数固定为无限
- MP4/WebM 视频导出使用 WebCodecs 硬编码；老旧浏览器回退 MediaRecorder（时长为实时录制）
