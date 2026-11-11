# macOS 窗口移动警告排查

排查日期：2026-11-11。状态：已定位到应用之外的原生拖动路径，尚未根治。

## 现象与环境

拖动标题栏时，进程 stderr 出现：

```text
Warning: Window move completed without beginning
```

本机为 macOS 27.2（26B123），项目锁定 Electron 38.8.6 / Chromium 140.0.7339.249。

## 排查证据

- `apps/client/electron/main.ts` 创建普通 `BrowserWindow`，未设置自定义标题栏；仓库没有 `will-move` / `move` / `moved` 回调，也没有自定义窗口拖动、`setPosition` 或 `setBounds` 调用。因此没有应用层移动回调参数可以补齐。
- 将业务代码、preload、React 和 IPC 全部移除，仅保留一个加载静态 HTML 的 `BrowserWindow`，通过桌面自动化拖动原生标题栏，仍可复现完全相同的 stderr 警告。
- 最小窗口分别使用项目的禁 GPU / sandbox 兼容参数和 Electron 默认参数，两组都能复现。不能据此把警告归因于 WSL 兼容参数。
- 真实客户端构建使用临时 userData 和空书库 IPC 替身，同样复现。两组最小窗口和真实客户端的自动化拖动均未触发 `will-move` / `move` / `moved`，采样坐标保持不变。没有调用模型、读写用户小说库或保存用户设置。
- 上述是自动化输入的复现证据，不能替代物理鼠标、多屏拖动或注销后的人工验收。

## 来源与结论

Chromium 140 的 `NativeWidgetMacNSWindowTitledFrame.mouseDown:` 调用 `cr_mouseDownOnFrameView:`，后者直接进入 AppKit 的 `performWindowDragWithEvent:`。该调用发生在 JavaScript 窗口移动通知之前，补监听器或修改回调形参无法修复它。

macOS 27.2 的上游问题报告记录了相同 API 的间歇性拖动失败，并报告某些远程/虚拟输入会话后 WindowServer 的拖动手势状态可能持续异常。这与本机复现相符；未对本机 WindowServer 内部状态做原生调试，因此具体系统触发条件仍待确认。

参考：

- [Chromium 140 原生窗口实现](https://github.com/chromium/chromium/blob/140.0.7339.249/components/remote_cocoa/app_shim/native_widget_mac_nswindow.mm)：`NSView (CRFrameViewAdditions)` 和 `NativeWidgetMacNSWindowTitledFrame`。
- [Warp 上游报告 #16508](https://github.com/warpdotdev/warp/issues/16508)：macOS 27.2 的同类原生拖动失败与 AppKit / 自行移动窗口的对照。
- [Claude Desktop 上游报告 #102613](https://github.com/anthropics/claude-code/issues/102613)：同类 Electron 现象、Apple Feedback FB25207761 及注销恢复的报告。

Electron #55518 涉及 Electron 45 / Chromium 156 的另一项跨屏窗口尺寸回归；本项目使用 Chromium 140，不能直接套用该问题的降级结论。

## 恢复与后续验证

1. 保存所有应用中的工作后，人工注销并重新登录 macOS，重建图形会话。上游报告此操作可临时恢复；本次没有执行注销或重启 WindowServer。
2. 重新启动客户端，用物理鼠标多次拖动标题栏，并观察 stderr；若使用远程桌面或虚拟输入，再比较相关会话前后表现。
3. 后续采用 macOS / Electron 的对应修复时，重复最小窗口与真实客户端对照，并补测双击标题栏、缩放、跨屏与系统贴边行为。

本次没有找到适用的受支持 Electron 配置修复，保留业务与窗口代码。没有屏蔽 stderr，也没有引入全局辅助功能权限、原生方法替换或自定义标题栏。原生补丁或自行实现拖动属于后续兼容方案，需要独立验证系统窗口行为。

## 工程检查

`bun run typecheck`、`bun run lint`、`bun run test`（715 项，71 个文件，0 失败）及客户端构建均通过。这些检查证明当前工程检查通过，不代表操作系统拖动问题已经修复。
