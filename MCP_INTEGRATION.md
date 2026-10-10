# MCP 集成说明

本文件说明本项目**实际**使用的麦当劳 MCP Server、实际发现的 Tool、调用流程与业务价值。
每项能力都标注真实状态；**未验证的不会写成已接通**。

- 官方入口：<https://open.mcd.cn/mcp/doc>
- 服务地址：`https://mcp.mcd.cn`（Streamable HTTP，Bearer 认证）
- 核查时间：**2026-10-09 23:51（GMT+8）**
- 证据文件：`docs/mcp_runtime_evidence.json`（脱敏，不含 Token）

---

## 1. 协议与连接验证结果

| 阶段 | 检查项 | 实际结果 | 状态 |
|---|---|---|---|
| initialize | 协议握手 | HTTP 200，`serverInfo: {name: "mcd-mcp", version: "1.0.0"}` | ✅ verified |
| initialize | 协议版本协商 | `2025-06-18` | ✅ verified |
| notifications/initialized | 初始化通知 | 已发送 | ✅ verified |
| tools/list | 工具发现 | HTTP 200，服务端返回 **35 个工具** | ✅ verified |
| now-time-info | 只读调用 | HTTP 200，`isError: false` | ✅ verified |

> **一个 Token 曾失效的真实记录**：首次探测返回 HTTP 401、正文"当前鉴权码不存在或已失效!"。
> 该结果如实记录在 `docs/mcp_auth_failure.json`。这说明**服务端可达、鉴权层正常工作**，
> 也说明"能发出请求"与"通过鉴权"是两件事。本文件不把 401 记为任何能力的 verified。

---

## 2. 运行时发现的工具分类

`tools/list` 共返回 35 个工具，客户端按名称与说明分类为：

- **只读／计算类：28 个**（`query-*`、`list-*`、`calculate-price`、`now-time-info` 等）
- **写操作／状态变更：7 个**（`create-order`、`cancel-order`、`auto-bind-coupons`、
  `mall-create-order`、`draw-lottery`、`party-order-create`、`delivery-create-address`）

**本项目不调用任何写操作。** 下单未付款也已创建外部状态；领券与扣积分不是无副作用动作。
隐藏工具不等于远端 Token 只有只读权限，因此不做"试一下看会怎样"的探测。

---

## 3. 核心只读工具的实际 schema

以下必填字段来自**认证后的 `tools/list` 运行时返回**，不是公开文档抄录，也不是从样例补造。

### `query-meals` — 门店菜单
- 必填：`storeCode`、`orderType`、`beType`
- 可选：`beCode`、`reservationDate`
- 枚举：`beType` 1-到店取餐／2-麦乐送到家／5-得来速(DT)／6-企业团餐；`orderType` 1-到店／2-外送

### `query-meal-detail` — 餐品详情
- 必填：`storeCode`、`orderType`、`beType`、**`code`**
- `code`：餐品唯一编码，门店内唯一标识单个餐品
- 重要约束：**到店自提场景 `orderType=1` 时 `beCode` 是无效参数，传了会报错**

### `query-store-coupons` — 门店可用券
- 必填：`storeCode`、`orderType`、`beType`
- `storeCode` 必须全部由数字组成

### `calculate-price` — 算价
- 必填：`storeCode`、`orderType`、`beType`
- 可选：`items`（数组）、`needTableware`（布尔）、`withOrder`（对象）、`gmServiceCode`、`reservationDate`
- **`needTableware` 的存在印证了餐具费是独立费用项**——省钱 Wizard 因此把餐具费单列，
  不用"商品金额 + 折扣"冒充完整应付成本

### `query-nearby-stores` — 附近门店
- 必填：`beType`、`searchType`
- 可选：`city`、`keyword`

### `now-time-info` — 时间查询
- 无必填字段；已调用成功

---

## 4. 逐能力状态

状态取值：`demo` / `notConnected` / `verifying` / `verified` / `expired` / `unavailable` / `error`

| 能力 | 状态 | 证据 | 说明 |
|---|---|---|---|
| 协议握手 | **verified** | HTTP 200 + serverInfo | 2026-10-09 |
| 工具发现 | **verified** | tools/list 返回 35 项 | 2026-10-09 |
| 时间查询 | **verified** | now-time-info → isError:false | 2026-10-09 |
| 门店查询 | **verified** | 城市+关键词 → 5 家真实门店 | 2026-10-10，经用户指定城市与关键词，未使用个人地址 |
| 菜单目录 | **verified** | 11 类 / 90 项实际可售 | 2026-10-10 |
| 餐品详情与规格 | **verified** | 返回真实规格组（酱料 5 项） | 2026-10-10 |
| 完整应付成本 | **verified** | ¥29.50，与 `productList` 小计逐项对账一致 | 2026-10-10 |
| 券资格 | **unavailable** | 该门店返回 0 张券 | 接口可调通，但无可用券样本，未验证资格逻辑 |
| 网页端真实数据 | **verified** | 门店→菜单→详情→官方算价 全链路通过 | 2026-10-10，见第 5 节 |
| 历史订单 | **notConnected（刻意不接）** | — | 本产品不需要个人订单历史，且不得通过公开站点暴露 |
| 下单 / 支付 / 领券 / 积分 / 新增地址 | **notConnected（刻意不接）** | — | 需另行明确授权；本轮未获授权 |

> 时间查询成功**不自动**把目录、报价、历史或页面标成 verified——每一项都在上表单独给出证据。
> 券资格虽然接口可调通，但因该门店 0 张券，**不标为 verified**。

---

## 5. 数据模式：真实接入的落地方式与边界

**真实接入已经完成并通过验证**，落地方式是"本机网关中转"：

```
浏览器（本机网页）
   │  仅 127.0.0.1，无任何公网出口
   ▼
gateway.js（唯一持有 Token 处，只读白名单 12 工具）
   │  Streamable HTTP + Bearer
   ▼
https://mcp.mcd.cn
```

为什么不让网页直连：官方 Token 不能出现在前端 JS、浏览器存储或任何公开部署中。
本项目没有做、也不会做"加一个代理绕过认证"的动作。

已实测跑通的真实链路（受控只读请求）：

| 环节 | 工具 | 实测结果 |
|---|---|---|
| 门店检索 | `query-nearby-stores` | 城市+关键词 → 5 家真实门店 |
| 菜单 | `query-meals` | 11 类 / 90 项实际可售 |
| 详情与规格 | `query-meal-detail` | 返回真实规格组（例：酱料 5 项） |
| 官方算价 | `calculate-price` | ¥29.50，与 `productList` 小计逐项对账一致 |

**凭据边界**：

- Token 只存在于网关进程内存，浏览器拿不到也取不到
- 每次启动生成一个会话能力令牌，仅通过同源 `/api/session` 下发给本项目网页自身
- 网关只监听 `127.0.0.1`；非本机 Host、精确端口外的 Origin 一律 403，且不返回 ACAO
- 写操作路径**架构上不存在**（下单/支付/领券/积分/新增地址均无对应路由，非"暂不开放"）

**许可边界**：本机单用户受控使用；多用户公开服务或商业化需另行核验官方条款。

**数据真实性**：

- 价格、库存、供应状态**只来自官方接口当次返回**
- 营养与过敏原官方未返回，界面一律标「未知」，**不从商品名称推断**
- 官方未返回有效报价（`productList` 为空或金额为 0）时按失败处理，**不显示 0 元**
- 门店打烊等业务码映射为可行动提示（例 `600057` → 引导换店），不透传上游原文

---

## 6. 调用流程（已执行，附实测样本）

一次完整会话的真实调用顺序：

1. `now-time-info` — 确认服务端时间
2. `query-nearby-stores` — 用户指定城市 + 关键词，拿到 `storeCode`
3. `query-meals` — 按 `storeCode` + `orderType` + `beType` 取该店实际可售菜单
4. `query-meal-detail` — 按 `code` 取规格与详情（到店场景不传 `beCode`）
5. `query-store-coupons` — 取该门店可用券，区分「可领」与「已拥有」
6. `calculate-price` — 取官方应付金额

每一步都记录实际 schema、返回样例与错误格式；金额单位**逐字段**验证，
不因为都叫 price 就统一按元或分解析（实测 `productList[].subtotal` 与 `price` 同为分）。

**并发与一致性处理**（第四轮整改重点）：

- 网关在请求发出时冻结门店、上下文版本与会话，返回后核验；期间换了门店则返回 `409 STALE`，**不会把 A 店结果标成 B 店**
- 前端在 `await` **之前**冻结 `requestId / ctxVersion / storeCode / cartSignature`，响应回来逐项核对，任一不符即丢弃
- 上下文（换店、换就餐方式）一变，旧报价立即作废；改数量、改规格、替换单品都会让报价标记为待重算
- 复制餐单时若报价已过期，明确标注「待重新算价」，**不得把旧金额当作当前官方价**，每行准确包含数量与规格

不同会话之间不共享任何可变购物车或报价状态（按会话 Map 隔离）。

---

## 7. 故障与回退

| 情况 | 产品行为 |
|---|---|
| 401／403 | 显示"官方只读连接未通过鉴权"，继续用演示目录 |
| 429 | 不自动重试；提示稍后再试 |
| 超时 | 显示"暂时无法读取官方数据"，可继续选餐 |
| 空目录 | 如实显示该门店无结果，不回退到虚构数据冒充 |
| 缺字段 | 标"待核实"，不猜测不补造 |
| 报价过期 | 重新核验后才采用，不拿旧价下单 |

---

## 8. 凭据处理

- 配置文件只写环境变量名，例如 `MCD_MCP_TOKEN`
- **不把 Token 写入前端、日志、截图、测试产物或本仓库**
- 探测脚本从本机配置读取 Token，只输出工具名、schema 字段名、状态码与脱敏结果，
  并在写出产物前自检"产物中不含 Token"
- 提交前运行 `node secret-scan.js`，只报告文件路径与计数，不打印秘密

配置示意（**仅占位符，不是可运行凭据**）：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

> 提交本仓库前请把上述文件替换为只含占位符的 `mcp-config.example.json`。