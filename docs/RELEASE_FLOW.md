# 本地 AI 开发与自动发布流程文档

> **适用场景**：你在本地使用 AI 开发项目，AI 完成编码后生成发布包，你本地验收，验收通过后 AI 自动发布到 GitHub。  
> **核心原则**：`main` 始终可部署；功能在短分支开发；本地验收是唯一人工门禁；发布 = 打标签 + 推送 + 自动创建 Release；无需 `release/*`、`develop` 等长期分支。  
> **版本**：1.0

---

## 0. 快速规则

- `main` 是唯一长期分支，必须始终可部署。
- 禁止直接向 `main` 推送代码，所有变更通过 `feature/*` 短分支 + PR 合并。
- 发布**不需要** `release/*` 分支，直接在 `main` 上打语义化标签（如 `v1.2.0`）。
- 本地验收是**唯一强制的人工环节**，验收通过后 AI 才能执行发布。
- 发布版本代码通过 **Git tag** 永久保存，随时可查。
- 推荐使用 **GitHub Actions** 监听标签推送，自动完成构建、打包、创建 Release。
- AI 执行 Git 操作时必须遵守 `ivangdavila/git` 的安全规则。
- 所有提交信息遵循 **Conventional Commits**。
- 版本号遵循 **SemVer**：`vMAJOR.MINOR.PATCH`。

---

## 1. 分支模型

| 分支 | 来源 | 合并目标 | 生命周期 | 用途 |
| :--- | :--- | :--- | :--- | :--- |
| `main` | - | - | 永久 | 生产稳定版本，发布标签打在此分支 |
| `feature/*` | `main` | `main` | 短期 | 新增功能 |
| `fix/*` | `main` | `main` | 短期 | Bug 修复 |
| `hotfix/*` | 旧版本标签 | `main` + 旧版本 | 按需 | 旧版本紧急修复 |

**不需要的分支**：`develop`、`release/*`、`support/*`。

### 分支关系图

```mermaid
gitGraph
    commit id: "init"
    branch feature/login
    checkout feature/login
    commit id: "feat"
    checkout main
    merge feature/login
    commit id: "v1.0.0" tag: "v1.0.0"
    branch feature/payment
    checkout feature/payment
    commit id: "feat"
    checkout main
    merge feature/payment
    commit id: "v1.1.0" tag: "v1.1.0"
    branch hotfix/v1.0.1
    checkout hotfix/v1.0.1
    commit id: "fix"
    checkout main
    merge hotfix/v1.0.1
    commit id: "v1.0.1" tag: "v1.0.1"
```

---

## 2. 命名与规范

### 2.1 分支命名

全小写，单词用连字符 `-`。

| 类型 | 格式 | 示例 |
| :--- | :--- | :--- |
| 功能 | `feature/<描述>` | `feature/user-login` |
| 修复 | `fix/<描述>` | `fix/payment-timeout` |
| 热修复 | `hotfix/<版本号>` | `hotfix/v1.0.1` |

### 2.2 提交规范：Conventional Commits

格式：

```text
<type>(<scope>): <subject>
```

常用类型：

| 类型 | 含义 |
| :--- | :--- |
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `build` | 构建系统 |
| `ci` | CI 配置 |
| `chore` | 杂项 |

示例：

```bash
git commit -m "feat(auth): add JWT token validation"
git commit -m "fix(api): handle empty payment response"
```

### 2.3 版本规范：SemVer

```text
vMAJOR.MINOR.PATCH
```

- `MAJOR`：不兼容的破坏性变更
- `MINOR`：向后兼容的新功能
- `PATCH`：向后兼容的 Bug 修复

标签必须使用附注标签：

```bash
git tag -a v1.2.0 -m "Release v1.2.0"
```

---

## 3. 完整工作流程

你的工作流分为五个阶段：

```text
[1. AI 本地开发] → [2. AI 生成发布包] → [3. 你本地验收]
                                              ↓
                                      验收不通过 → 回到 [1]
                                              ↓
                                      验收通过 → [4. 你说"发布"]
                                              ↓
                                      [5. AI 自动发布到 GitHub]
```

### 阶段 1：AI 本地开发

**你的操作**：向 AI 描述需求。

**AI 执行**：

```bash
# 确保在 main 分支且最新
git checkout main
git pull origin main

# 创建功能分支
git checkout -b feature/user-login

# 开发并提交
git add .
git commit -m "feat(auth): add user login form"
git push -u origin feature/user-login
```

**可选**：创建 PR 到 `main`，但**不合并**，等验收通过后再合并。

```bash
gh pr create --base main --head feature/user-login \
  --title "feat(auth): add user login form" \
  --body "## 变更说明\n新增用户登录表单。"
```

### 阶段 2：AI 生成发布包

**你的操作**：对 AI 说“帮我打包，我要验收”。

**AI 执行**：

```bash
# 确保工作区干净
git status --short

# 构建项目
npm run build          # 或对应项目的构建命令

# 生成发布包
tar -czf release-v0.1.0.tar.gz ./dist
# 或
zip -r release-v0.1.0.zip ./dist
```

AI 应告诉你发布包路径，例如：

```text
✅ 发布包已生成：./release-v0.1.0.tar.gz
请验收。
```

### 阶段 3：你本地验收

**你的操作**：

- 解压发布包
- 运行/检查功能
- 确认是否满足发布要求

**验收不通过**：

你对 AI 说具体问题，AI 回到阶段 1 修改代码，然后重新打包。

**验收通过**：

你对 AI 说：“验收通过，发布 v0.1.0。”

### 阶段 4：AI 自动发布（合并 + 打标签 + 推送）

**AI 执行**：

```bash
# 1. 检查工作区干净
git status --short

# 2. 切换到 main 并拉取最新
git checkout main
git pull origin main

# 3. 合并功能分支
git merge --no-ff feature/user-login -m "merge: feature/user-login"

# 4. 推送 main
git push origin main

# 5. 创建附注标签
git tag -a v0.1.0 -m "Release v0.1.0"

# 6. 推送标签（触发 GitHub Actions）
git push origin v0.1.0

# 7. 删除功能分支
git branch -d feature/user-login
git push origin --delete feature/user-login
```

**如果使用了 GitHub Actions**，到这里 AI 的工作就结束了，后续由 Actions 自动完成。

**如果没有使用 Actions**，AI 继续执行：

```bash
# 创建 GitHub Release 并上传本地打包好的文件
gh release create v0.1.0 ./release-v0.1.0.tar.gz \
  --title "v0.1.0" \
  --generate-notes
```

### 阶段 5：GitHub Actions 自动发布（推荐）

见下一节。

---

## 4. GitHub Actions 自动化（推荐）

**结论：是的，用 GitHub Actions 更好。** 原因：

| 对比项 | AI 本地打包 + 手动发布 | GitHub Actions 自动发布 |
| :--- | :--- | :--- |
| 依赖 AI 本地环境 | 是，环境不一致会导致包不一致 | 否，环境统一 |
| AI 需要执行 `gh release create` | 是 | 否，只需推送标签 |
| 发布流程可追溯 | 依赖 AI 日志 | Actions 日志永久保存 |
| 多人协作 | 差 | 好 |
| 安全性 | AI 需要 GitHub Token 写权限 | Token 只在 Actions 中使用 |
| 可重复性 | 低 | 高 |

**推荐架构**：

```text
AI 本地开发 → AI 本地打包 → 你验收
                                  ↓
                          验收通过 → AI 打标签 + 推送
                                  ↓
                          GitHub Actions 自动构建、打包、创建 Release
```

这样，AI 只需要做两件事：**打标签** 和 **推送标签**。构建、打包、发布全部由 GitHub Actions 完成。

### 4.1 Actions 工作流配置

创建 `.github/workflows/release.yml`：

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Package
        run: tar -czf release-${{ github.ref_name }}.tar.gz ./dist

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          files: release-${{ github.ref_name }}.tar.gz
          generate_release_notes: true
          draft: false
          prerelease: false
```

### 4.2 工作流说明

| 步骤 | 作用 |
| :--- | :--- |
| `on.push.tags: v*` | 只有推送 `v` 开头的标签时触发 |
| `permissions.contents: write` | 允许创建 Release |
| `actions/checkout` | 检出标签对应的代码 |
| `setup-node` | 配置 Node 环境（按项目调整） |
| `npm ci` | 安装依赖 |
| `npm run build` | 构建 |
| `tar -czf` | 打包 |
| `softprops/action-gh-release` | 创建 Release 并上传资产 |
| `generate_release_notes` | 自动生成 Release Notes |

### 4.3 AI 只需要执行

```bash
git checkout main
git pull origin main
git merge --no-ff feature/user-login -m "merge: feature/user-login"
git push origin main
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

推送标签后，GitHub Actions 自动完成剩余工作。

### 4.4 如何查看发布结果

- GitHub 仓库 → `Actions` 标签页 → 查看工作流运行日志
- GitHub 仓库 → `Releases` 页面 → 查看已创建的 Release 和上传的资产

---

## 5. 查看历史发布版本代码

发布版本代码通过 **Git tag** 永久保存，随时可查。

### 5.1 本地查看

```bash
# 拉取所有标签
git fetch --tags

# 列出所有标签
git tag -l

# 切换到某个发布版本
git checkout v0.1.0

# 查看该版本代码
ls -la

# 返回 main
git checkout main
```

或使用 `git switch --detach`：

```bash
git switch --detach v0.1.0
```

### 5.2 GitHub 网页查看

- 仓库主页 → `Code` → 分支下拉框 → `Tags` → 选择 `v0.1.0`
- 或直接访问：`https://github.com/<用户>/<仓库>/tree/v0.1.0`

### 5.3 下载发布版本源码

- 仓库 → `Releases` → 选择版本 → `Source code (zip)` / `Source code (tar.gz)`
- 或下载 Actions 上传的构建产物

### 5.4 对比版本差异

```bash
# 对比两个版本
git diff v0.1.0 v0.2.0

# 查看某版本之后的提交
git log v0.1.0..v0.2.0 --oneline
```

---

## 6. 旧版本热修复流程

当已发布版本出现严重 Bug，需要为旧版本打补丁。

### 6.1 从旧标签创建热修复分支

```bash
git checkout -b hotfix/v0.1.1 v0.1.0
```

### 6.2 修复并提交

```bash
git add .
git commit -m "fix(security): patch token leak"
git push -u origin hotfix/v0.1.1
```

### 6.3 合并到 main 并打补丁标签

```bash
git checkout main
git pull origin main
git merge --no-ff hotfix/v0.1.1 -m "merge: hotfix/v0.1.1"
git push origin main

git tag -a v0.1.1 -m "Release v0.1.1"
git push origin v0.1.1
```

### 6.4 清理

```bash
git branch -d hotfix/v0.1.1
git push origin --delete hotfix/v0.1.1
```

如果该修复也适用于最新版本，需要确保 `main` 已包含该修复。

---

## 7. AI 工具执行规则

### 7.1 操作前强制检查

```bash
git status --short          # 必须无输出，否则停止并询问用户
git branch --show-current   # 确认当前分支
git fetch origin
```

遇到冲突、CI 失败、权限不足时，停止并请求人工处理。

### 7.2 触发词与动作映射

| 用户指令 | AI 应执行 |
| :--- | :--- |
| “新增功能：xxx” | 从 `main` 创建 `feature/xxx`，开发，提交，推送，创建 PR 到 `main` |
| “修复：xxx” | 从 `main` 创建 `fix/xxx`，修复，提交，推送，创建 PR 到 `main` |
| “打包，我要验收” | 执行构建和打包命令，生成发布包，告诉用户路径 |
| “验收通过，发布 vX.Y.Z” | 合并功能分支到 `main`，推送 `main`，打标签，推送标签 |
| “热修复：xxx” | 从旧标签创建 `hotfix/vX.Y.Z`，修复，合并 `main`，打补丁标签 |

### 7.3 AI 禁止事项

- 禁止直接向 `main` 推送代码（除合并功能分支外）。
- 禁止对 `main` 执行 `git push --force`。
- 禁止在用户未说“验收通过，发布”之前执行发布动作。
- 禁止删除远程标签或 Release。
- 禁止跳过本地验收直接发布。
- 禁止创建 `release/*` 或 `develop` 分支。

### 7.4 常用 `gh` 命令

```bash
# 创建 PR
gh pr create --base main --head feature/xxx --title "feat: xxx" --body "..."

# 查看 PR 状态
gh pr status

# 查看 Release 列表
gh release list

# 查看某个 Release
gh release view v1.0.0

# 手动创建 Release（如果不用 Actions）
gh release create v1.0.0 ./release.tar.gz --title "v1.0.0" --generate-notes
```

---

## 8. `ivangdavila/git` 技能配置

安装：

```bash
npx clawhub@latest install ivangdavila/git
```

配置文件 `~/Clawic/data/git/config.yaml`：

```yaml
# 保护 main 分支，AI 不会直接推送
protected_branches:
  - main

# 禁止强制推送
force_push_policy: never

# 提交信息遵循 Conventional Commits
commit_style: conventional

# 分支命名规范
branch_naming: "feature/{topic}"

# 合并方式
integration_style: merge
```

**作用**：

- 防止 AI 误操作 `main` 分支
- 防止强制推送
- 保证提交信息规范
- 统一分支命名

---

## 9. 检查清单

### 开发前
- [ ] 已切换到 `main`
- [ ] 已拉取最新代码
- [ ] 工作区干净

### 提交前
- [ ] 提交信息符合 Conventional Commits
- [ ] 本地测试通过

### 打包前
- [ ] 工作区干净
- [ ] 所有功能已提交
- [ ] 构建命令正确

### 验收时
- [ ] 解压发布包
- [ ] 运行核心功能
- [ ] 确认版本号正确
- [ ] 确认无严重 Bug

### 发布前
- [ ] 用户已明确说“验收通过，发布”
- [ ] `main` 最新且 CI 通过
- [ ] 版本号符合 SemVer
- [ ] 标签名称正确

### 发布后
- [ ] 标签已推送
- [ ] GitHub Actions 运行成功（如使用）
- [ ] GitHub Release 已创建
- [ ] 构建产物已上传
- [ ] 相关 Issue 已关闭

---

## 10. 场景速查表

| 场景 | 起点 | 目标 | 命令摘要 |
| :--- | :--- | :--- | :--- |
| 新增功能 | `main` | `feature/*` | `git checkout -b feature/xxx main` |
| 打包验收 | 功能分支 | 本地发布包 | `npm run build && tar -czf release.tar.gz ./dist` |
| 验收通过发布 | 功能分支 | `main` + tag | `git checkout main && git merge feature/xxx && git tag -a vX.Y.Z` |
| 热修复 | 旧标签 | `main` + 新 tag | `git checkout -b hotfix/vX.Y.Z vX.Y.Z` |
| 查看发布版本 | - | tag | `git checkout vX.Y.Z` |
| 对比版本 | - | - | `git diff v1.0.0 v1.1.0` |
| 回滚发布 | - | 新 patch | `git revert <commit> && git tag -a vX.Y.Z+1` |

---

## 11. 命令速查

```bash
# 查看分支
git branch -a

# 切换分支
git checkout main

# 拉取最新
git pull origin main

# 创建并切换分支
git checkout -b feature/xxx

# 添加并提交
git add .
git commit -m "feat: add xxx"

# 推送分支
git push -u origin feature/xxx

# 合并分支
git merge --no-ff feature/xxx

# 创建附注标签
git tag -a v1.0.0 -m "Release v1.0.0"

# 推送标签
git push origin v1.0.0

# 查看所有标签
git tag -l

# 切换到某个版本
git checkout v1.0.0

# 删除本地分支
git branch -d feature/xxx

# 删除远程分支
git push origin --delete feature/xxx

# 查看状态
git status

# 查看日志
git log --oneline --graph --all

# 查看 Release 列表
gh release list

# 查看某个 Release
gh release view v1.0.0
```

---

## 12. 常见问题

### Q1：需要 `release/*` 分支吗？

**不需要。** 本地验收已经承担了发布准备的职责。发布版本通过 tag 永久保存。

### Q2：发布版本代码还能找到吗？

**能。** 通过 tag（如 `v1.0.0`）永久指向发布 commit。可以本地 checkout，也可以在 GitHub 上浏览或下载源码。

### Q3：用 GitHub Actions 更好吗？

**是的。** Actions 可以统一构建环境，AI 只需推送标签，构建、打包、发布全部自动完成。可重复性、可追溯性、安全性都更好。

### Q4：AI 需要 GitHub Token 吗？

如果使用 GitHub Actions，AI 只需要 `git push` 权限，不需要 `gh release create` 权限。Token 只在 Actions 中使用，更安全。

### Q5：验收不通过怎么办？

你对 AI 说具体问题，AI 回到功能分支修改代码，重新打包，你再验收。直到通过为止。

### Q6：如何保护发布标签？

在 GitHub 仓库 `Settings` → `Tags` 或 `Rulesets` 中，添加规则保护 `v*`，禁止删除和强制移动。

### Q7：`ivangdavila/git` 和本文档冲突吗？

**不冲突。** `ivangdavila/git` 是 AI 执行 Git 命令的安全执行器，本文档是流程规范。前者保证 AI 不犯错，后者告诉 AI 走什么流程。
