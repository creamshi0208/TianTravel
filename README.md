# 我的旅行攻略

一个**单文件、离线可用**的旅行攻略网站。首页是攻略卡片墙，点进去是逐日路书详情。

- 站点地址（开启 Pages 后）：`https://<你的用户名>.github.io/<仓库名>/`
- 全部内容在 `index.html` 一个文件里，图片已内联为 base64，**双击即可打开，无需服务器**

---

## 一、本地看效果

直接双击 `index.html` 就行。

---

## 二、推送到 GitHub

> 前提：你已注册 GitHub 账号并登录。仓库需要是 **Public（公开）** 才能免费用 Pages。

### 1. 建仓库

浏览器打开 https://github.com/new

- Repository name：比如 `travel-guide`
- 选 **Public**
- **不要**勾选 "Add a README file"（否则会和本地冲突）
- 点 Create repository

### 2. 在本地初始化并推送

打开 **Git Bash**，逐条执行：

```bash
cd /d/BED/旅游攻略/web

git init
git add .
git commit -m "init: 旅游攻略站点"
git branch -M main
git remote add origin https://github.com/<你的用户名>/travel-guide.git
git push -u origin main
```

把 `<你的用户名>` 换成你的 GitHub 用户名。仓库名如果起的不是 `travel-guide`，两处都要改。

### 3. 认证（这一步会卡人）

你的机器上**没有装 gh CLI、没有 SSH key、也没有配凭据助手**，所以 `git push` 会弹框要账号密码。
GitHub 早就不支持用登录密码推送了，必须先建一个 Token：

1. 打开 https://github.com/settings/tokens → **Generate new token (classic)**
2. Note 随便填，Expiration 选 90 天
3. 勾选 **`repo`** 这一个权限就够了
4. 点 Generate token，**把 `ghp_` 开头的那串复制下来**（关掉页面就再也看不到了）
5. 回到 Git Bash 执行 push 时：
   - Username 填 **GitHub 用户名**
   - Password 填 **刚才那串 Token**（不是你的登录密码）

第一次成功后 Windows 会把它存进凭据管理器，后续不用再输。想永久记住可以执行一次：

```bash
git config --global credential.helper manager
```

### 4. 开启 Pages

仓库页面 → **Settings** → 左侧 **Pages**：

- Source：`Deploy from a branch`
- Branch：`main` ／ 目录选 **`/ (root)`**
- 点 **Save**

等 1–2 分钟，访问 `https://<你的用户名>.github.io/travel-guide/` 就能看到了。

> 如果 404：先在 Actions 标签页确认部署任务跑完了，再等一分钟刷新。

---

## 三、后续更新

改了 `index.html` 之后：

```bash
cd /d/BED/旅游攻略/web
git add .
git commit -m "更新：xxx"
git push
```

Pages 会自动重新部署。

---

## 四、以后怎么加新攻略（安吉 / 象山 / 新疆 …）

站点不是手写的 HTML，是**从数据生成**的。流程：

```bash
cd /d/BED/旅游攻略

# 1. 把新攻略的 HTML 解析成统一 JSON
python tools/parse_guide.py <源文件.html> tools/out/guide-<id>.json \
    --images miniprogram/assets/<id> --assets-prefix /assets/<id>

# 2. 在 tools/build_miniapp.py 的 GUIDES 列表里加一条（含省市二级分类）
#    'regions': [{'province': '浙江', 'city': '湖州'}]          单项
#    'regions': [{'province': '新疆', 'city': '乌鲁木齐'},
#                {'province': '新疆', 'city': '喀什'}]          跨市
#    跨省线路就多写几条，筛选时任意一条命中即出现

# 3. 重新生成
python tools/build_miniapp.py    # 更新 tools/out/index.json
python tools/build_web.py        # 生成网站
```

`build_web.py` 会自动：

- 压缩 `miniprogram/assets/<id>/` 里的图片并内联
- 生成首页卡片（自动归属到省份 / 地级市两级分类）
- 生成详情页并接上 hash 路由 `#/<id>`

新增攻略不需要改任何 HTML 或 CSS。

> **注意**：省市分类的**唯一来源是 `build_miniapp.py` 的 `GUIDES`**。
> 不要直接改 `tools/out/index.json`，它下次跑 `build_miniapp.py` 会被覆盖。

---

## 五、二级分类（省份 / 地级市）怎么工作

首页筛选区是**级联**的两行：

| 层级 | 行为 |
|---|---|
| **省份** | 点某个省份 → 卡片筛到该省，下面「地级市」一行**自动收敛**为该省下辖的市 |
| **地级市** | 只在当前省份范围内显示可选城市；也可以不选省份直接点某市 |
| 全部 | 两级都有「全部」，点省份会自动把城市重置为「全部」 |
| 空态 | 筛不出结果时显示「该分类下暂无攻略」，不会出现空白 |

一篇攻略可以属于多个省市（跨省线路），只要在 `regions` 里多写几条，任一命中就会出现在结果里。

---

## 六、怎么让我直接帮你推到 GitHub

我现在就能执行推送，但需要你提供三样东西：

| 需要什么 | 从哪里拿 |
|---|---|
| **GitHub 用户名** | https://github.com/settings/profile → 最上面的 Username |
| **仓库名** | 还没建的话告诉我名字（比如 `travel-guide`），我来建；已建的话给我仓库地址 |
| **Personal Access Token** | https://github.com/settings/tokens → Generate new token (classic) → 勾 `repo` → 生成后复制 `ghp_...` |

拿到之后我就能一条龙做完：本地提交 → 建仓库 → 推送 → 开 Pages，最后给你线上地址。

**关于 Token 的安全提醒**：它等同于你的仓库读写权限。建议

- 有效期选 **7 天或 90 天**，别选 No expiration
- 只勾 **`repo`**，不要勾 `delete_repo`、`admin:*` 之类的
- 用完随时可以回到同一页面点 **Revoke** 撤销
- 不要贴在公开的群里 / 截图里

**不想手搓 Token 的替代方案**：装 GitHub CLI（`winget install GitHub.cli`），然后 `gh auth login` 走一次浏览器授权，之后我就不需要碰任何 Token 了。你想走这条路的话，告诉我，我来装。

---

## 备注

- 单文件约 0.97 MB，首屏秒开，适配手机
- 图片来源：攻略原文内嵌图，已压到 660px / 质量 66
- 生成脚本：`tools/build_web.py`（依赖 Pillow）
