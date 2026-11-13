# Three.js 本地构建

当前目录保存 `three@0.187.0` 的官方 ESM 构建，供总览页 3D 工位懒加载使用。

- 来源：`https://unpkg.com/three@0.187.0/build/`
- 许可证：MIT，原始文件头已保留
- `three.module.js` SHA-256：`104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341`
- `three.core.js` SHA-256：`613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578`

当前环境无法解析 npm registry，因此先锁定官方构建并在本地复用。网络恢复后可改为 `pnpm add three@0.187.0`，再从组件中恢复包导入。
