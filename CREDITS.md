# 致谢与来源

本工作台基于 [swjybky/deepwrite](https://github.com/swjybky/deepwrite) 的 DeepWrite。感谢原作者及贡献者提供桌面写作界面、智能体运行机制、资料库、技能库和本地文稿管理基础。原项目的 Apache-2.0 许可证完整保留在 [LICENSE](LICENSE)。本仓库是独立改版，不代表上游发布或上游对修改的认可。

本改版由仓库维护者提出需求、确定创作规则并审核功能。增加的功能包括：阶段与章节对话隔离、资料版本与来源检查、候选保存、多个模型比较、要求与正文证据核对，以及工作台和 Codex 的双向协作入口。当前源码以本地改版快照交付，保留上游来源说明；没有把原项目重新署名为维护者独创。

开发过程中使用 Codex 辅助实现、测试和审计。AI 工具不被列为项目第一作者，不添加“by Codex”式署名；需求裁决与最终采用由维护者负责。提交账号是版本管理记录，不能替代真实的作者与来源说明。

## 内置参考技能

技能内容仅作为审阅方法参考，不是作品事实、作者规则或自动写入授权。各包的许可证保存在包内；来源与文件 hash 位于 `packages/pi-runtime-adapter/src/review-skills/bundle.json`。

| 来源 | 许可 | 当前快照版本标记 |
| --- | --- | --- |
| [Humanizer-zh / op7418](https://github.com/op7418/Humanizer-zh) | MIT | 本地记录 2026-09-23 |
| [human-writing / KKKKhazix](https://github.com/KKKKhazix/human-writing) | MIT | 本地记录 1.1.0 |
| [Sepia / Nanako0129](https://github.com/Nanako0129/sepia) | MIT | 本地记录 0.12.3 |
| [说人话 / MrGeDiao](https://github.com/MrGeDiao/shuorenhua) | MIT | e7c2b8670bd3e1988bfec199e861cebd87fc5e9c |

前三项的日期或版本标记是继承的本地来源记录，不冒充已核验的不可变 Git 提交。文件 hash 可核验本仓库的内容完整性。依赖包各自的许可不被根目录 Apache-2.0 覆盖；发布二进制时应随包保留 Electron、Chromium 与依赖许可。
