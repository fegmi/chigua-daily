# 🍉 瓜条头版 — 实时投稿网页

一个支持视频、图片、文字实时投稿的网页系统。所有访问者都能即时看到最新投稿。

## 快速开始

```powershell
npm install
npm start
```

然后打开浏览器访问 `http://localhost:3000`

## 功能

- **三种投稿类型**：视频（≤500MB）、图片、纯文字
- **实时更新**：基于 SSE（Server-Sent Events），一人发布，所有人即时看到
- **拖拽上传**：支持点击选择和拖拽文件两种方式
- **本地预览**：上传图片/视频后可在提交前预览
- **响应式布局**：桌面端双栏 / 移动端单栏自适应
- **持久化存储**：投稿数据自动保存到 `submissions.json`，重启不丢失

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express |
| 文件上传 | Multer |
| 实时推送 | SSE (`/stream`) |
| 前端 | 原生 HTML / CSS / JS |

## 目录结构

```
├── server.js          # 后端服务入口
├── package.json       # 依赖配置
├── submissions.json   # 投稿数据（自动生成）
├── uploads/           # 上传文件（自动生成）
│   ├── images/
│   └── videos/
└── public/            # 前端静态文件
    ├── index.html
    ├── style.css
    └── app.js
```

## API

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/submissions` | 获取所有投稿列表 |
| POST | `/api/submit` | 提交新投稿（multipart/form-data） |
| GET | `/stream` | SSE 实时推送端点 |

### POST /api/submit 参数

| 字段 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| `title` | string | 否 | 标题 |
| `content` | string | 否 | 正文内容 |
| `file` | file | 否 | 图片或视频文件 |

## 访问方式

本机访问：`http://localhost:3000`

局域网其他设备访问：`http://<你的IP>:3000`
