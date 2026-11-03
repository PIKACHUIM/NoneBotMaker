import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Pagination,
  Popconfirm,
  Segmented,
  Select,
  Skeleton,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { FormInstance, TableColumnsType } from 'antd';
import {
  ApiOutlined,
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  BookOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  GithubOutlined,
  LoginOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MessageOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  CHATBOT_PLUGIN_TYPE,
  DEFAULT_NON_MENTION_REPLY_RATE,
} from '../shared/types';
import type {
  BotAccountRecord,
  ConversationLog,
  DatabaseSetupStatus,
  GroupRecord,
  JsonObject,
  Language,
  LibraryKind,
  LibraryRecord,
  ModelPriceRecord,
  PluginFieldDefinition,
  PluginRecord,
  PolicyRecord,
  PolicyType,
  ProjectMemoryRecord,
  MemoryType,
  ProviderRecord,
} from '../shared/types';
import {
  conversationFields,
  conversationIdList,
  defaultFieldValues,
  normalizeFieldValues,
  pluginDefinition,
  pluginDefinitions,
  policyFields,
} from '../shared/plugin-catalog';
import { MODEL_PRICE_CHECKED_AT, MODEL_PRICE_PRESETS } from '../shared/model-pricing';
import { LanguageProvider, useI18n } from './i18n';
import { ApiError, api } from './api';
import type { ChatbotConversationStatus, ChatbotConversationSummary, ChatbotMemeSummary, ChatbotSlangCandidate, ChatbotVoiceSummary, ChatbotWake } from './api';

const { Title, Text, Paragraph } = Typography;
const { Sider, Content } = Layout;

type AdminPage = 'overview' | 'plugins' | 'accounts' | 'groups' | 'conversations' | 'integrations' | 'logs';
type Route = { kind: 'home' } | { kind: 'login' } | { kind: 'setup' } | { kind: 'admin'; page: AdminPage };
type LibraryData = Record<LibraryKind, LibraryRecord[]>;
type LogFilters = { q?: string; pluginId?: string; openid?: string; accountId?: string; groupId?: string; from?: string; to?: string };

const libraryNames: Record<LibraryKind, string> = { skills: '技能', mcps: 'MCP', rules: '规则' };
const pageTitles: Record<AdminPage, { title: string; eyebrow: string; description: string }> = {
  overview: { title: '运行总览', eyebrow: 'CONTROL ROOM / 01', description: '查看 Bot 实例、群聊与扩展能力的当前配置。' },
  plugins: { title: '插件管理', eyebrow: 'RUNTIME / 02', description: '管理已注册的 TypeScript 插件及其运行状态。' },
  accounts: { title: '平台账号', eyebrow: 'INSTANCES / 03', description: '为同一插件配置多个平台实例与鉴权参数。' },
  groups: { title: '群聊策略', eyebrow: 'POLICIES / 04', description: '选择接口能力策略，并按会话覆盖模型、提示词与扩展能力。' },
  conversations: { title: '会话管理', eyebrow: 'CHAT BRIDGE / 05', description: '管理会话运行状态、模式、静默、提示与工具；模型、供应商、白名单和预算请在群聊策略配置。' },
  integrations: { title: '接口能力', eyebrow: 'CONNECTORS / 05', description: '配置 AI 供应商与单价，以及身份、对话、语音、记忆策略和技能、MCP、规则。' },
  logs: { title: '对话日志', eyebrow: 'OBSERVABILITY / 06', description: '筛选近期对话记录。日志受服务端 LOG_RECORD 配置控制。' },
};

function currentRoute(): Route {
  const path = window.location.hash.slice(1);
  if (path) {
    if (path === '/setup') return { kind: 'setup' };
    if (path === '/login') return { kind: 'login' };
    if (path.startsWith('/admin')) {
      const page = path.split('/')[2] as AdminPage | undefined;
      const valid: AdminPage[] = ['overview', 'plugins', 'accounts', 'groups', 'conversations', 'integrations', 'logs'];
      return { kind: 'admin', page: valid.includes(page as AdminPage) ? page as AdminPage : 'overview' };
    }
    return { kind: 'home' };
  }
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  return pathname === '/setup' ? { kind: 'setup' } : { kind: 'home' };
}

function go(path: string) {
  window.location.hash = path;
}

function prettyDate(value?: string | number, language: Language = 'zh') {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}

function parseTimestamp(value?: string) {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function policyName(policies: PolicyRecord[], type: PolicyType, id?: string): string {
  return policies.find((item) => item.type === type && item.id === id)?.name ?? '';
}

const policyTypeNames: Record<PolicyType, string> = { dialog: '对话策略', voice: '语音策略', identity: '身份策略' };

function StatusTag({ enabled }: { enabled: boolean }) {
  const { tr } = useI18n();
  return <Tag className={`status-tag ${enabled ? 'status-on' : 'status-off'}`} bordered={false}>{enabled ? tr('运行中') : tr('已停用')}</Tag>;
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-mark${compact ? ' brand-mark-compact' : ''}`} aria-label="NoneBotMaker">
      <span className="brand-glyph" aria-hidden="true"><i /><i /><i /><i /></span>
      {!compact && <span className="brand-wordmark">NONEBOT<span>MAKER</span></span>}
    </span>
  );
}

function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="landing-header">
        <a className="brand-link" href="#/" aria-label="NoneBotMaker 首页"><BrandMark /></a>
        <nav className="landing-nav" aria-label="主导航">
          <a href="#features">平台能力</a>
          <a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer">源代码 <ArrowUpOutlined /></a>
          <Button type="primary" icon={<LoginOutlined />} href="#/login">管理员登录</Button>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> SERVERLESS BOT STUDIO <span className="eyebrow-index">01 / 04</span></div>
          <h1>把机器人运行时，<br /><span>交还给你。</span></h1>
          <p className="hero-lead">在一个控制台中编排插件、平台账号与群聊策略。面向边缘环境构建，配置随部署运行。</p>
          <div className="hero-actions">
            <Button type="primary" size="large" icon={<LoginOutlined />} href="#/login">进入管理台</Button>
            <a className="text-link" href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer"><GithubOutlined /> 查看开源项目 <ArrowRightOutlined /></a>
          </div>
          <div className="hero-meta">
            <div><span className="meta-label">RUNTIME</span><strong>EDGE / SERVERLESS</strong></div>
            <div><span className="meta-label">PLUGIN</span><strong>TYPESCRIPT FIRST</strong></div>
            <div><span className="meta-label">CONTROL</span><strong>SELF-HOSTED</strong></div>
          </div>
        </div>
        <div className="hero-visual" aria-label="机器人运行结构示意图">
          <div className="visual-topline"><span>RUNTIME MAP</span><span>NBM / 2026</span></div>
          <div className="runtime-map">
            <div className="map-node map-node-plugin"><CodeOutlined /><span>PLUGIN</span><small>chatbot / ts</small></div>
            <div className="map-link map-link-a"><i /></div>
            <div className="map-node map-node-account"><RobotOutlined /><span>ACCOUNT</span><small>multi-instance</small></div>
            <div className="map-link map-link-b"><i /></div>
            <div className="map-node map-node-group"><TeamOutlined /><span>GROUP</span><small>policy / model</small></div>
            <div className="map-orbit orbit-one" /><div className="map-orbit orbit-two" />
            <div className="map-core"><BrandMark compact /><span>CONTROL<br />PLANE</span></div>
          </div>
          <div className="visual-legend"><span><i className="legend-dot" /> CONFIGURED FLOW</span><span>01 PLUGIN → N ACCOUNTS → N GROUPS</span></div>
          <div className="visual-coordinate">36° 04′ 28″ N&nbsp;&nbsp; / &nbsp;&nbsp;118° 22′ 11″ E</div>
        </div>
      </section>

      <section className="landing-strip" id="features" aria-label="核心能力">
        <div className="strip-heading"><span>一个工作面</span><span>三层控制</span></div>
        <article><span className="feature-index">A / EXTENSION</span><CodeOutlined /><h2>插件可控</h2><p>插件、实例与群聊策略分层管理，启停状态一目了然。</p></article>
        <article><span className="feature-index">B / INTELLIGENCE</span><ThunderboltOutlined /><h2>模型可换</h2><p>为每个群聊选择供应商与模型，成本参数独立配置。</p></article>
        <article><span className="feature-index">C / EDGE</span><CloudServerOutlined /><h2>边缘部署</h2><p>围绕 Serverless 运行设计，让配置与运行环境保持贴近。</p></article>
        <div className="strip-footer"><span>OPEN SOURCE / TYPESCRIPT</span><a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer">EXPLORE REPOSITORY <ArrowRightOutlined /></a></div>
      </section>
      <footer className="landing-footer"><BrandMark compact /><span>NONEBOTMAKER / SERVERLESS BOT STUDIO</span><span>BUILT FOR THE EDGE</span></footer>
    </main>
  );
}

function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [form] = Form.useForm<{ password: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (values: { password: string }) => {
    setBusy(true);
    setError('');
    try {
      await api.login(values.password);
      onSuccess();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <header className="login-header"><a className="brand-link" href="#/"><BrandMark /></a><a href="#/" className="back-link">返回首页 <ArrowRightOutlined /></a></header>
      <div className="login-layout">
        <section className="login-context">
          <div className="eyebrow"><span className="eyebrow-line" /> AUTHENTICATED ACCESS <span className="eyebrow-index">ADMIN / 01</span></div>
          <h1>运行控制，<br /><span>从这里开始。</span></h1>
          <p>管理插件、机器人账号与群聊 AI 策略。所有配置通过服务端接口持久化。</p>
          <div className="login-seal"><SafetyCertificateOutlined /><span>仅授权管理员可访问</span><small>SESSION / HTTP-ONLY COOKIE</small></div>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <div className="panel-index">ACCESS TERMINAL <span>AUTH-01</span></div>
          <div className="login-icon"><LoginOutlined /></div>
          <Title level={2} id="login-title">管理员登录</Title>
          <Paragraph>输入管理员密码以继续。</Paragraph>
          {error && <Alert className="form-alert" type="error" showIcon message={error} />}
          <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
            <Form.Item name="password" label="管理员密码" rules={[{ required: true, message: '请输入管理员密码' }]}>
              <Input.Password size="large" autoComplete="current-password" placeholder="输入管理员密码" />
            </Form.Item>
            <Button block type="primary" size="large" htmlType="submit" loading={busy} icon={<LoginOutlined />}>验证并进入</Button>
          </Form>
          <Button type="link" href="/setup" className="setup-entry">首次部署？初始化数据库</Button>
          <div className="login-footnote"><span className="online-dot" /> SESSION COOKIE ENCRYPTED <span>HTTPS 推荐</span></div>
        </section>
      </div>
      <footer className="login-footer"><span>NONEBOTMAKER / ADMIN CONSOLE</span><a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer"><GithubOutlined /> GITHUB</a></footer>
    </main>
  );
}

function SetupPage() {
  const [form] = Form.useForm<{ token: string }>();
  const [status, setStatus] = useState<DatabaseSetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      setStatus(await api.setupStatus());
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async ({ token }: { token: string }) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.initializeDatabase(token));
      form.resetFields();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusy(false);
    }
  };

  const ready = status?.schemaReady === true;
  const connected = status?.databaseConfigured === true;

  return (
    <main className="login-shell setup-shell">
      <header className="login-header">
        <a className="brand-link" href="/" aria-label="NoneBotMaker 首页"><BrandMark /></a>
        <a href="#/login" className="back-link">管理员登录 <ArrowRightOutlined /></a>
      </header>
      <div className="login-layout setup-layout">
        <section className="login-context">
          <div className="eyebrow"><span className="eyebrow-line" /> SYSTEM BOOTSTRAP <span className="eyebrow-index">SETUP / 00</span></div>
          <h1>初始化<br /><span>数据平面。</span></h1>
          <p>首次部署需要把基础表结构与迁移记录写入 D1。初始化脚本可重复执行，不会清空已有配置或对话数据。</p>
          <div className="setup-facts">
            <div><span>STORAGE</span><strong>D1 / SQLITE</strong></div>
            <div><span>TOKEN</span><strong>SYS_SECRET</strong></div>
            <div><span>EXECUTION</span><strong>IDEMPOTENT</strong></div>
          </div>
        </section>

        <section className="login-panel setup-panel" aria-labelledby="setup-title">
          <div className="panel-index">DATABASE BOOTSTRAP <span>SETUP-01</span></div>
          <div className="login-icon"><DatabaseOutlined /></div>
          <Title level={2} id="setup-title">数据库初始化</Title>
          <Paragraph>检查当前 D1 绑定并应用基础表结构。管理员密码由部署环境的 <code>SYS_PASSWD</code> 提供，不在此页面设置。</Paragraph>

          {error && <Alert className="form-alert" type="error" showIcon message={error} />}
          {checking && !status && <div className="setup-checking"><Spin size="small" /><span>正在检查数据库状态…</span></div>}

          {status && (
            <div className="setup-status">
              <div><span>D1 BINDING</span><Tag bordered={false} className={`setup-badge ${connected ? 'setup-badge-on' : 'setup-badge-off'}`}>{connected ? 'CONNECTED' : 'MISSING'}</Tag></div>
              <div><span>SCHEMA</span><Tag bordered={false} className={`setup-badge ${ready ? 'setup-badge-on' : 'setup-badge-wait'}`}>{ready ? 'READY' : 'PENDING'}</Tag></div>
              <div><span>MIGRATION LEDGER</span><strong>{status.pendingMigrations === 0 ? 'SYNCED' : `${status.pendingMigrations} PENDING`}</strong></div>
            </div>
          )}

          {status && !ready && status.missing.length > 0 && (
            <p className="setup-hint">待创建：{status.missing.join(' · ')}</p>
          )}

          {ready ? (
            <div className="setup-complete">
              <Alert type="success" showIcon message="数据库已就绪" description="基础表、对话日志表、chatbot 状态表与迁移记录均已写入。" />
              <Button block type="primary" size="large" href="#/login" icon={<LoginOutlined />}>前往管理员登录</Button>
            </div>
          ) : (
            <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
              <Form.Item
                name="token"
                label="SYS_SECRET"
                rules={[{ required: true, message: '请输入 SYS_SECRET' }]}
              >
                <Input.Password size="large" autoComplete="off" placeholder="输入部署时配置的 SYS_SECRET" disabled={!connected} />
              </Form.Item>
              <Button block type="primary" size="large" htmlType="submit" loading={busy} disabled={!connected} icon={<DatabaseOutlined />}>执行初始化</Button>
            </Form>
          )}
          <div className="login-footnote"><span className="online-dot" /> DATABASE / D1 <span>REFRESH TO RECHECK</span></div>
        </section>
      </div>
      <footer className="login-footer"><span>NONEBOTMAKER / DATABASE BOOTSTRAP</span><a href="https://github.com/PIKACHUIM/NoneBotMaker" target="_blank" rel="noreferrer"><GithubOutlined /> GITHUB</a></footer>
    </main>
  );
}

function AdminConsole({ page, onLogout }: { page: AdminPage; onLogout: () => void }) {
  const { message } = AntApp.useApp();
  const { language, setLanguage, tr } = useI18n();
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [plugins, setPlugins] = useState<PluginRecord[]>([]);
  const [accounts, setAccounts] = useState<BotAccountRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [prices, setPrices] = useState<ModelPriceRecord[]>([]);
  const [libraries, setLibraries] = useState<LibraryData>({ skills: [], mcps: [], rules: [] });
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [memories, setMemories] = useState<ProjectMemoryRecord[]>([]);
  const [logs, setLogs] = useState<ConversationLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsEnabled, setLogsEnabled] = useState<boolean | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [logFilters, setLogFilters] = useState<LogFilters>({});
  const [filterForm] = Form.useForm<LogFilters>();

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const handleError = useCallback((reason: unknown) => {
    const error = formatError(reason);
    setActionError(error);
    message.error(error);
  }, [message]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    setActionError('');
    const load = async () => {
      try {
        switch (page) {
          case 'overview': {
            const [pluginData, accountData, groupData, providerData] = await Promise.all([
              api.listPlugins(), api.listAccounts(), api.listGroups(), api.listProviders(),
            ]);
            if (!active) return;
            setPlugins(pluginData); setAccounts(accountData); setGroups(groupData); setProviders(providerData);
            break;
          }
          case 'plugins': setPlugins(await api.listPlugins()); break;
          case 'accounts': {
            const [pluginData, accountData] = await Promise.all([api.listPlugins(), api.listAccounts()]);
            if (!active) return;
            setPlugins(pluginData); setAccounts(accountData);
            break;
          }
          case 'groups': {
            const [groupData, accountData, pluginData, providerData, priceData, skillData, mcpData, ruleData, policyData] = await Promise.all([
              api.listGroups(), api.listAccounts(), api.listPlugins(), api.listProviders(), api.listPrices(),
              api.listLibraries('skills'), api.listLibraries('mcps'), api.listLibraries('rules'), api.listPolicies(),
            ]);
            if (!active) return;
            setGroups(groupData); setAccounts(accountData); setPlugins(pluginData); setProviders(providerData); setPrices(priceData);
            setLibraries({ skills: skillData, mcps: mcpData, rules: ruleData });
            setPolicies(policyData);
            break;
          }
          case 'conversations': {
            const [groupData, accountData] = await Promise.all([api.listGroups(), api.listAccounts()]);
            if (!active) return;
            setGroups(groupData); setAccounts(accountData);
            break;
          }
          case 'integrations': {
            const [providerData, priceData, skillData, mcpData, ruleData, policyData, accountData] = await Promise.all([
              api.listProviders(), api.listPrices(), api.listLibraries('skills'), api.listLibraries('mcps'), api.listLibraries('rules'), api.listPolicies(), api.listAccounts(),
            ]);
            const memoryData = await Promise.all(accountData.map((account) => api.listProjectMemories(account.id)));
            if (!active) return;
            setProviders(providerData); setPrices(priceData); setLibraries({ skills: skillData, mcps: mcpData, rules: ruleData });
            setPolicies(policyData); setAccounts(accountData); setMemories(memoryData.flat());
            break;
          }
          case 'logs': {
            const [result, pluginData, accountData, groupData] = await Promise.all([
              api.listLogs({
                page: logPage,
                pageSize: 20,
                q: logFilters.q,
                pluginId: logFilters.pluginId,
                openid: logFilters.openid,
                accountId: logFilters.accountId,
                groupId: logFilters.groupId,
                from: parseTimestamp(logFilters.from),
                to: parseTimestamp(logFilters.to),
              }), api.listPlugins(), api.listAccounts(), api.listGroups(),
            ]);
            if (!active) return;
            setLogs(result.items); setLogsTotal(result.total); setLogsEnabled(result.enabled); setPlugins(pluginData); setAccounts(accountData); setGroups(groupData);
            break;
          }
        }
      } catch (reason) {
        if (active) setLoadError(formatError(reason));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [page, refreshKey, logPage, logFilters]);

  const navItems = [
    { key: 'overview', icon: <BookOutlined />, label: tr('运行总览') },
    { key: 'plugins', icon: <CodeOutlined />, label: tr('插件管理') },
    { key: 'accounts', icon: <RobotOutlined />, label: tr('平台账号') },
    { key: 'groups', icon: <TeamOutlined />, label: tr('群聊策略') },
    { key: 'conversations', icon: <MessageOutlined />, label: tr('会话管理') },
    { key: 'integrations', icon: <ApiOutlined />, label: tr('接口能力') },
    { key: 'logs', icon: <MessageOutlined />, label: tr('对话日志') },
  ];
  const title = pageTitles[page];
  const setPage = (key: string) => {
    setMobileNav(false);
    go(`/admin/${key}`);
  };
  const logout = async () => {
    try { await api.logout(); } catch (reason) { handleError(reason); }
    onLogout();
  };

  return (
    <Layout className="admin-layout">
      <Sider className={`admin-sider${mobileNav ? ' admin-sider-open' : ''}`} width={252} theme="dark" aria-label={tr('管理台导航')}>
        <a className="sider-brand" href="#/admin/overview"><BrandMark /></a>
        <div className="workspace-label"><span className="workspace-dot" /> LOCAL CONTROL PLANE</div>
        <Menu mode="inline" selectedKeys={[page]} items={navItems} onClick={({ key }) => setPage(key)} className="admin-menu" />
        <div className="sider-bottom">
          <div className="sider-status"><span className="online-dot" /><span>{tr('管理会话已验证')}</span><span className="sider-status-meta">SECURE</span></div>
          <button type="button" className="logout-button" onClick={() => void logout()}><LogoutOutlined /> {tr('退出管理台')}</button>
          <div className="sider-version"><span>NONEBOTMAKER</span><span>CONSOLE / 0.2</span></div>
        </div>
      </Sider>
      {mobileNav && <button type="button" aria-label={tr('关闭导航')} className="nav-backdrop" onClick={() => setMobileNav(false)} />}
      <Layout className="admin-main-layout">
        <header className="admin-topbar">
          <button type="button" aria-label={tr('打开导航菜单')} className="mobile-menu-button" onClick={() => setMobileNav(true)}><MenuFoldOutlined /></button>
          <div className="breadcrumbs"><span>CONTROL PLANE</span><span>/</span><strong>{tr(title.title)}</strong></div>
          <div className="topbar-right">
            <Segmented
              className="language-switch"
              size="small"
              value={language}
              onChange={(value) => setLanguage(value as Language)}
              options={[{ label: '中', value: 'zh' }, { label: 'EN', value: 'en' }]}
              aria-label={tr('选择语言')}
            />
            <span className="topbar-health"><i /> API SESSION ACTIVE</span>
            <Tooltip title={tr('刷新当前数据')}><Button type="text" aria-label={tr('刷新当前数据')} icon={<ReloadOutlined />} onClick={refresh} /></Tooltip>
            <a href="#/" className="topbar-home">{tr('公开首页')} <ArrowRightOutlined /></a>
          </div>
        </header>
        <Content className="admin-content">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> {title.eyebrow}</div><Title level={1}>{tr(title.title)}</Title><Paragraph>{tr(title.description)}</Paragraph></div>
            <div className="page-heading-actions"><span className="sync-stamp">LAST REQUEST<br /><b>LIVE API DATA</b></span></div>
          </div>
          {actionError && <Alert className="action-alert" type="error" showIcon closable onClose={() => setActionError('')} message={actionError} />}
          {loading ? <div className="page-loading" role="status" aria-label={tr('正在读取服务端配置…')}><span>{tr('正在读取服务端配置…')}</span><div className="page-skeleton"><Skeleton active title paragraph={{ rows: 3 }} /><Skeleton active title paragraph={{ rows: 2 }} /></div></div> : loadError ? (
            <div className="page-error"><Alert type="error" showIcon message={tr('无法读取此页面数据')} description={loadError} action={<Button size="small" icon={<ReloadOutlined />} onClick={refresh}>{tr('重试')}</Button>} /></div>
          ) : (
            <>
              {page === 'overview' && <OverviewPage plugins={plugins} accounts={accounts} groups={groups} providers={providers} onNavigate={setPage} />}
              {page === 'plugins' && <PluginsPage data={plugins} onRefresh={refresh} onError={handleError} />}
              {page === 'accounts' && <AccountsPage plugins={plugins} data={accounts} onRefresh={refresh} onError={handleError} />}
              {page === 'groups' && <GroupsPage groups={groups} plugins={plugins} accounts={accounts} providers={providers} libraries={libraries} policies={policies} onRefresh={refresh} onError={handleError} />}
              {page === 'conversations' && <ChatbotRuntimePage groups={groups} accounts={accounts} onError={handleError} onNavigate={setPage} />}
              {page === 'integrations' && <IntegrationsPage providers={providers} prices={prices} libraries={libraries} policies={policies} accounts={accounts} memories={memories} onRefresh={refresh} onError={handleError} />}
              {page === 'logs' && <LogsPage data={logs} total={logsTotal} enabled={logsEnabled} plugins={plugins} accounts={accounts} groups={groups} page={logPage} onPage={setLogPage} form={filterForm} onFilter={(values) => { setLogPage(1); setLogFilters(values); }} />}
            </>
          )}
          <footer className="content-footer"><span>EDGE CONFIGURATION / NONEBOTMAKER</span><span>SESSION ISOLATED <i /></span></footer>
        </Content>
      </Layout>
    </Layout>
  );
}

function OverviewPage({ plugins, accounts, groups, providers, onNavigate }: {
  plugins: PluginRecord[]; accounts: BotAccountRecord[]; groups: GroupRecord[]; providers: ProviderRecord[]; onNavigate: (page: string) => void;
}) {
  const { tr } = useI18n();
  const activeAccounts = accounts.filter((item) => item.enabled).length;
  const activeGroups = groups.filter((item) => item.enabled).length;
  const activePlugins = plugins.filter((item) => item.enabled).length;
  return (
    <div className="overview-page">
      <section className="overview-banner">
        <div><span className="banner-label"><span className="online-dot" /> CONFIGURATION PLANE / ONLINE</span><h2>{tr('一眼掌握运行边界。')}</h2><p>{tr('数据直接读取当前管理 API；新增和修改配置后将以服务端结果为准。')}</p></div>
        <div className="banner-code"><span>ENVIRONMENT</span><strong>EDGE / SERVERLESS</strong><span>CONTROL MODEL</span><strong>PLUGIN → ACCOUNT → GROUP</strong></div>
      </section>
      <div className="metric-grid">
        <MetricTile index="01" label={tr('启用插件')} value={activePlugins} total={plugins.length} icon={<CodeOutlined />} onClick={() => onNavigate('plugins')} />
        <MetricTile index="02" label={tr('运行账号')} value={activeAccounts} total={accounts.length} icon={<RobotOutlined />} onClick={() => onNavigate('accounts')} />
        <MetricTile index="03" label={tr('启用群聊')} value={activeGroups} total={groups.length} icon={<TeamOutlined />} onClick={() => onNavigate('groups')} />
        <MetricTile index="04" label={tr('AI供应商')} value={providers.filter((item) => item.enabled).length} total={providers.length} icon={<ApiOutlined />} onClick={() => onNavigate('integrations')} />
      </div>
      <div className="overview-columns">
        <Card className="section-card overview-flow" title={<SectionTitle index="A" title={tr('配置拓扑')} subtitle="CONFIGURATION GRAPH" />} extra={<Button type="link" onClick={() => onNavigate('groups')}>{tr('管理群聊')} <ArrowRightOutlined /></Button>}>
          <div className="flow-row"><span className="flow-icon"><CodeOutlined /></span><div><strong>{tr('插件')}</strong><small>{tr('逻辑与接入协议')}</small></div><b>{plugins.length.toString().padStart(2, '0')}</b><ArrowRightOutlined className="flow-arrow" /><span className="flow-icon"><RobotOutlined /></span><div><strong>{tr('账号')}</strong><small>{tr('平台机器人实例')}</small></div><b>{accounts.length.toString().padStart(2, '0')}</b><ArrowRightOutlined className="flow-arrow" /><span className="flow-icon"><TeamOutlined /></span><div><strong>{tr('群聊')}</strong><small>{tr('按群独立策略')}</small></div><b>{groups.length.toString().padStart(2, '0')}</b></div>
          <div className="flow-caption"><span>PLUGIN</span><i /><span>MULTI-ACCOUNT</span><i /><span>GROUP POLICY</span></div>
        </Card>
        <Card className="section-card overview-quick" title={<SectionTitle index="B" title={tr('快捷操作')} subtitle="CONTROL SHORTCUTS" />}>
          <button className="quick-row" onClick={() => onNavigate('plugins')}><span><CodeOutlined /></span><div><strong>{tr('检查插件运行状态')}</strong><small>{tr('查看已注册插件与启停配置')}</small></div><ArrowRightOutlined /></button>
          <button className="quick-row" onClick={() => onNavigate('accounts')}><span><PlusOutlined /></span><div><strong>{tr('添加机器人实例')}</strong><small>{tr('创建账号并关联现有插件')}</small></div><ArrowRightOutlined /></button>
          <button className="quick-row" onClick={() => onNavigate('integrations')}><span><SettingOutlined /></span><div><strong>{tr('配置模型与工具')}</strong><small>{tr('供应商、Skills、MCP、Rules')}</small></div><ArrowRightOutlined /></button>
        </Card>
      </div>
      <div className="overview-bottom"><span><CheckCircleOutlined /> SERVICE DATA</span><strong>{tr('配置来源为管理 REST API，不提供演示数据回退。')}</strong><span>LOG RETENTION / 30 DAYS</span></div>
    </div>
  );
}

function MetricTile({ index, label, value, total, icon, onClick }: { index: string; label: string; value: number; total: number; icon: React.ReactNode; onClick: () => void }) {
  const { tr } = useI18n();
  return <button className="metric-tile" onClick={onClick}><div className="metric-top"><span>{index} / {label}</span><span className="metric-icon">{icon}</span></div><div className="metric-value">{String(value).padStart(2, '0')}<small> / {String(total).padStart(2, '0')}</small></div><div className="metric-bottom"><span>{tr('已启用 / 总数')}</span><ArrowRightOutlined /></div></button>;
}

function SectionTitle({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="section-title"><span>{index}</span><div><strong>{title}</strong><small>{subtitle}</small></div></div>;
}

function PageToolbar({ count, noun, action, onCreate }: { count: number; noun: string; action: string; onCreate: () => void }) {
  return <div className="page-toolbar"><span>RECORDS <b>{String(count).padStart(2, '0')}</b> / {noun}</span><Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>{action}</Button></div>;
}

function EmptyTable({ title, description, onCreate, action }: { title: string; description: string; onCreate?: () => void; action?: string }) {
  const { tr } = useI18n();
  return <div className="empty-state"><div className="empty-index">NO RECORD / 000</div><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span><b>{title}</b><br />{description}</span>} />{onCreate && <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>{action ?? tr('创建第一条')}</Button>}</div>;
}

function useDrawer() {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const edit = (id?: string) => { setEditingId(id); setOpen(true); };
  const close = () => setOpen(false);
  return { open, editingId, edit, close };
}

function PluginFieldInput({ field, editing = false, id, value, checked, onChange }: {
  field: PluginFieldDefinition;
  editing?: boolean;
  id?: string;
  value?: string | number;
  checked?: boolean;
  onChange?: (...args: unknown[]) => void;
}) {
  const { tr, localized } = useI18n();
  const placeholder = field.placeholder ? localized(field.placeholder) : undefined;
  if (field.options) {
    return <Select id={id} value={value as string | undefined} onChange={onChange} placeholder={placeholder} options={field.options.map((option) => ({ value: option.value, label: localized(option.label) }))} />;
  }
  if (field.type === 'boolean') {
    return <Switch id={id} checked={checked} onChange={onChange} checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} />;
  }
  if (field.type === 'number') {
    return <InputNumber id={id} value={value as number | undefined} onChange={onChange} className="full-width" min={field.min} max={field.max} step={field.step} placeholder={placeholder} />;
  }
  if (field.secret) {
    return <Input.Password id={id} value={value as string | undefined} onChange={onChange} autoComplete="new-password" placeholder={editing ? tr('留空保持现有值') : placeholder} />;
  }
  if (field.multiline) {
    return <Input.TextArea id={id} value={value as string | undefined} onChange={onChange} rows={3} placeholder={placeholder} />;
  }
  return <Input id={id} value={value as string | undefined} onChange={onChange} placeholder={placeholder} />;
}

function PluginField({ field, path, editing = false }: { field: PluginFieldDefinition; path: Array<string | number>; editing?: boolean }) {
  const { tr, localized } = useI18n();
  return (
    <Form.Item
      name={path}
      label={localized(field.label)}
      extra={localized(field.description)}
      valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
      rules={field.required && !(editing && field.secret) ? [{ required: true, message: tr('此字段为必填项') }] : undefined}
    >
      <PluginFieldInput field={field} editing={editing} />
    </Form.Item>
  );
}

function SchemaFields({ fields, path, editing = false }: { fields: PluginFieldDefinition[]; path: string; editing?: boolean }) {
  const { tr, localized } = useI18n();
  const sections = new Map<string, PluginFieldDefinition[]>();
  for (const field of fields) {
    const label = field.group ? localized(field.group) : tr('其他');
    sections.set(label, [...(sections.get(label) ?? []), field]);
  }
  return <div className="schema-fields">{[...sections].map(([label, items]) => <section key={label} className="schema-section"><div className="form-section-heading"><span>{label}</span><small>{items.length} FIELDS</small></div>{items.map((field) => <PluginField key={field.key} field={field} path={[path, field.key]} editing={editing} />)}</section>)}</div>;
}

function editableFieldValues(fields: PluginFieldDefinition[], previous: JsonObject = {}) {
  const values = { ...defaultFieldValues(fields), ...previous };
  for (const field of fields) {
    if (field.secret) values[field.key] = '';
  }
  return values;
}

function PluginsPage({ data, onRefresh, onError }: { data: PluginRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { language, tr, localized } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const selectedType = (Form.useWatch('type', { form, preserve: true }) as string | undefined) ?? editing?.type ?? CHATBOT_PLUGIN_TYPE;
  const definition = pluginDefinition(selectedType);
  const configFields = definition?.configFields ?? [];
  const typeOptions = pluginDefinitions().map((item) => ({ value: item.type, label: `${localized(item.name)} · ${item.type}` }));
  if (selectedType && !definition) typeOptions.push({ value: selectedType, label: selectedType });
  const configSections = configFields.reduce<Array<{ label: string; fields: PluginFieldDefinition[] }>>((sections, field) => {
    const label = field.group ? localized(field.group) : tr('其他');
    const section = sections.at(-1);
    if (section?.label === label) section.fields.push(field);
    else sections.push({ label, fields: [field] });
    return sections;
  }, []);

  const initialConfig = useMemo(() => editableFieldValues(pluginDefinition(editing?.type ?? CHATBOT_PLUGIN_TYPE)?.configFields ?? [], editing?.config), [editing]);

  useEffect(() => {
    if (!drawer.open) return;
    const timer = window.setTimeout(() => {
      form.setFieldsValue({
        name: editing?.name ?? '',
        type: editing?.type ?? CHATBOT_PLUGIN_TYPE,
        description: editing?.description ?? '',
        enabled: editing?.enabled ?? true,
        config: initialConfig,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [drawer.open, editing, form, initialConfig]);

  const save = async (values: { name: string; type: string; description?: string; enabled: boolean; config?: JsonObject }) => {
    setSaving(true);
    try {
      const currentDefinition = pluginDefinition(values.type);
      const config = {
        ...(editing?.config ?? {}),
        ...(currentDefinition ? normalizeFieldValues(currentDefinition.configFields, values.config) : values.config ?? {}),
      };
      await api.savePlugin({ name: values.name, type: values.type, description: values.description ?? '', enabled: values.enabled, config }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<PluginRecord> = [
    { title: tr('插件'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><CodeOutlined /></span><span><strong>{name}</strong><small>{row.id}</small></span></div> },
    { title: tr('类型'), dataIndex: 'type', key: 'type', render: (value: string) => <code className="type-code">{value}</code> },
    { title: tr('实例'), key: 'accounts', render: (_, row) => <span className="table-mono">{(row as PluginRecord & { accountCount?: number }).accountCount ?? '—'}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.savePlugin({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除插件')}“${row.name}”？`} description={tr('关联实例可能无法继续运行。')} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deletePlugin(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <section className="data-page"><PageToolbar count={data.length} noun="PLUGINS" action={tr('新增插件')} onCreate={() => drawer.edit()} />
    {data.length ? <Table<PluginRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 780 }} className="data-table" /> : <EmptyTable title={tr('还没有插件')} description={tr('创建插件记录，再配置平台账号与群聊。')} onCreate={() => drawer.edit()} action={tr('创建插件')} />}
    <Drawer title={<DrawerTitle label="PLUGIN RECORD" title={editing ? tr('编辑插件') : tr('新增插件')} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存插件')}</Button></div>}>
      <Form
        key={editing?.id ?? 'new-plugin'}
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={save}
        initialValues={{
          name: editing?.name ?? '',
          type: editing?.type ?? CHATBOT_PLUGIN_TYPE,
          description: editing?.description ?? '',
          enabled: editing?.enabled ?? true,
          config: initialConfig,
        }}
      >
        <Form.Item name="name" label={tr('插件名称')} rules={[{ required: true, message: tr('请输入插件名称') }]}><Input placeholder={tr('例如：群聊助手')} /></Form.Item>
        <Form.Item name="type" label={tr('插件类型')} rules={[{ required: true, message: tr('请输入插件类型') }]}><Select options={typeOptions} placeholder={CHATBOT_PLUGIN_TYPE} onChange={(type: string) => form.setFieldValue('config', editableFieldValues(pluginDefinition(type)?.configFields ?? [], type === editing?.type ? editing.config : {}))} /></Form.Item>
        <Form.Item name="description" label={tr('插件说明')}><Input.TextArea rows={3} placeholder={tr('描述插件用途')} /></Form.Item>
        {configFields.length ? <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('插件设置')}</span><small>{definition?.type} / {configFields.length} FIELDS</small></div>
          {configSections.map((section) => <div key={section.label} className="schema-section">
            <div className="form-section-heading"><span>{section.label}</span><small>{section.fields.length} FIELDS</small></div>
            {section.fields.map((field) => <PluginField key={field.key} field={field} path={['config', field.key]} editing={Boolean(editing)} />)}
          </div>)}
        </div> : <Alert type="info" showIcon message={tr('该插件类型没有声明可配置项。')} />}
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function AccountsPage({ plugins, data, onRefresh, onError }: { plugins: PluginRecord[]; data: BotAccountRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const selectedPluginId = (Form.useWatch('pluginId', { form, preserve: true }) as string | undefined) ?? editing?.pluginId;
  const selectedPlugin = plugins.find((item) => item.id === selectedPluginId);
  const definition = pluginDefinition(selectedPlugin?.type);
  const credentialFields = definition?.credentialFields ?? [];
  const accountFields = definition?.accountFields ?? [];
  useEffect(() => {
    if (!drawer.open) return;
    const currentDefinition = pluginDefinition(plugins.find((item) => item.id === editing?.pluginId)?.type);
    form.resetFields();
    form.setFieldsValue({
      pluginId: editing?.pluginId,
      protocol: editing?.protocol ?? 'qq',
      name: editing?.name ?? '',
      enabled: editing?.enabled ?? true,
      credentials: editableFieldValues(currentDefinition?.credentialFields ?? [], editing?.credentials),
      config: editableFieldValues(currentDefinition?.accountFields ?? [], editing?.config),
    });
  }, [drawer.open, editing, form, plugins]);
  const save = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const credentials = values.credentials as JsonObject ?? {};
      await api.saveAccount({
        pluginId: values.pluginId as string,
        protocol: String(values.protocol ?? ''),
        name: String(values.name),
        enabled: Boolean(values.enabled),
        credentials,
        config: {
          ...(editing?.config ?? {}),
          ...normalizeFieldValues(pluginDefinition(plugins.find((item) => item.id === values.pluginId)?.type)?.accountFields ?? [], values.config as JsonObject),
        },
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<BotAccountRecord> = [
    { title: tr('机器人账号'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><RobotOutlined /></span><span><strong>{name}</strong><small>{row.id}</small></span></div> },
    { title: tr('插件'), dataIndex: 'pluginId', key: 'pluginId', render: (id: string) => plugins.find((item) => item.id === id)?.name ?? id },
    { title: tr('平台协议'), dataIndex: 'protocol', key: 'protocol', render: (value: string) => value || '—' },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('群聊'), key: 'groups', render: (_, row) => <span className="table-mono">{row.config.groupCount as number ?? '—'}</span> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveAccount({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除账号')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteAccount(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <section className="data-page"><PageToolbar count={data.length} noun="BOT ACCOUNTS" action={tr('新增账号')} onCreate={() => drawer.edit()} />
    {data.length ? <Table<BotAccountRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 780 }} className="data-table" /> : <EmptyTable title={tr('还没有机器人账号')} description={tr('选择插件并创建账号实例，可为每个平台分别保存凭据。')} onCreate={() => drawer.edit()} action={tr('新增机器人账号')} />}
    <Drawer title={<DrawerTitle label="BOT INSTANCE" title={editing ? tr('编辑机器人账号') : tr('新增机器人账号')} />} width={600} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存账号')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('实例名称')} rules={[{ required: true, message: tr('请输入实例名称') }]}><Input placeholder={tr('例如：主群机器人')} /></Form.Item>
        <Form.Item name="pluginId" label={tr('关联插件')} rules={[{ required: true, message: tr('请选择插件') }]}><Select placeholder={tr('选择插件')} options={plugins.map((item) => ({ label: item.name, value: item.id }))} onChange={(pluginId: string) => {
          const nextDefinition = pluginDefinition(plugins.find((item) => item.id === pluginId)?.type);
          form.setFieldsValue({ credentials: editableFieldValues(nextDefinition?.credentialFields ?? [], pluginId === editing?.pluginId ? editing.credentials : {}), config: editableFieldValues(nextDefinition?.accountFields ?? [], pluginId === editing?.pluginId ? editing.config : {}) });
        }} /></Form.Item>
        {!plugins.length && <Alert type="warning" showIcon message={tr('当前没有插件记录，请先创建插件。')} />}
        <Form.Item name="protocol" label={tr('平台协议')}><Select options={(definition?.protocols ?? ['qq']).map((protocol) => ({ label: protocol.toUpperCase(), value: protocol }))} /></Form.Item>
        {credentialFields.length ? <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('账号凭据')}</span><small>{definition?.type} / {credentialFields.length} FIELDS</small></div>
          {credentialFields.map((field) => <PluginField key={field.key} field={field} path={['credentials', field.key]} editing={Boolean(editing)} />)}
          {editing && <p className="form-note">{tr('敏感字段留空会保留现有值。')}</p>}
        </div> : <Alert type="info" showIcon message={tr('该插件类型没有声明账号字段。')} />}
        {accountFields.length > 0 && <SchemaFields fields={accountFields} path="config" editing={Boolean(editing)} />}
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function SlangReviewEditor({ candidate, onSave }: { candidate: ChatbotSlangCandidate; onSave: (details: { meaning: string; usage: string; example: string; risk: string; sources: string[] }) => void }) {
  const { tr } = useI18n();
  const [form] = Form.useForm<{ meaning: string; usage: string; example: string; risk: string; sourcesText: string }>();
  useEffect(() => {
    form.setFieldsValue({ meaning: candidate.meaning ?? candidate.definition ?? '', usage: candidate.usage ?? '', example: candidate.example ?? '', risk: candidate.risk ?? '', sourcesText: candidate.sources.join('\n') });
  }, [candidate, form]);
  return <Form form={form} layout="vertical" onFinish={(values) => onSave({ meaning: values.meaning, usage: values.usage, example: values.example, risk: values.risk, sources: values.sourcesText.split(/\s+/).filter(Boolean) })}>
    <div className="form-grid two-cols"><Form.Item name="meaning" label={tr('释义')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item><Form.Item name="usage" label={tr('使用场景')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item><Form.Item name="example" label={tr('示例')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item><Form.Item name="risk" label={tr('歧义与风险')}><Input.TextArea rows={2} maxLength={1000} /></Form.Item></div>
    <Form.Item name="sourcesText" label={tr('公共来源 HTTPS URL')} extra={tr('每行一个公开 HTTPS 链接；私网地址会被拒绝。')}><Input.TextArea rows={2} maxLength={5000} /></Form.Item>
    <Button size="small" htmlType="submit">{tr('保存研究内容')}</Button>
  </Form>;
}

function ChatbotRuntimePage({ groups, accounts, onError, onNavigate }: { groups: GroupRecord[]; accounts: BotAccountRecord[]; onError: (error: unknown) => void; onNavigate: (page: AdminPage) => void }) {
  const { tr } = useI18n();
  const { message } = AntApp.useApp();
  const [conversationTargets, setConversationTargets] = useState<ChatbotConversationSummary[]>([]);
  const [selectedConversationKey, setSelectedConversationKey] = useState('');
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationListError, setConversationListError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [conversationListRevision, setConversationListRevision] = useState(0);
  const [status, setStatus] = useState<ChatbotConversationStatus | null>(null);
  const [approvals, setApprovals] = useState<ChatbotConversationStatus['pendingApprovals']>([]);
  const [wakes, setWakes] = useState<ChatbotWake[]>([]);
  const [memes, setMemes] = useState<ChatbotMemeSummary[]>([]);
  const [memeError, setMemeError] = useState('');
  const [voices, setVoices] = useState<ChatbotVoiceSummary[]>([]);
  const [voiceError, setVoiceError] = useState('');
  const [slang, setSlang] = useState<ChatbotSlangCandidate[]>([]);
  const [slangTerm, setSlangTerm] = useState('');
  const [slangContext, setSlangContext] = useState('');
  const [slangError, setSlangError] = useState('');
  const [wakeError, setWakeError] = useState('');
  const [mode, setMode] = useState('chat');
  const [silent, setSilent] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [disabledToolsText, setDisabledToolsText] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedConversation = conversationTargets.find((item) => JSON.stringify([item.id, item.externalId]) === selectedConversationKey);
  const selectedGroup = groups.find((item) => item.id === selectedConversation?.id);
  useEffect(() => {
    let active = true;
    setConversationLoading(true);
    setConversationListError('');
    api.listChatbotConversations().then((items) => {
      if (!active) return;
      setConversationTargets(items);
      const keys = items.map((item) => JSON.stringify([item.id, item.externalId]));
      setSelectedConversationKey((current) => keys.length ? keys.includes(current) ? current : keys[0] : '');
    }).catch((reason) => {
      if (!active) return;
      setConversationTargets([]);
      setSelectedConversationKey('');
      setConversationListError(formatError(reason));
    }).finally(() => { if (active) setConversationLoading(false); });
    return () => { active = false; };
  }, [groups, conversationListRevision]);
  const refresh = useCallback(async () => {
    if (!selectedConversation || !selectedGroup) {
      setStatus(null); setApprovals([]); setWakes([]); setMemes([]); setVoices([]);
      setStatusError(selectedConversation ? tr('所选会话策略尚未加载，请刷新会话列表。') : '');
      return;
    }
    try {
      const [current, pending] = await Promise.all([
        api.getChatbotConversation(selectedGroup.accountId, selectedGroup.id, selectedConversation.externalId),
        api.listChatbotApprovals(selectedGroup.accountId, selectedGroup.id, selectedConversation.externalId),
      ]);
      setStatusError('');
      setStatus(current); setApprovals(pending.items); setMode(current.mode); setSilent(current.silent);
      setDisabledToolsText(current.disabledTools.join('\n'));
      setInitialPrompt(current.initialPrompt ?? '');
      try {
        const wakeResult = await api.controlChatbotConversation<{ items: ChatbotWake[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'wakeList', externalId: selectedConversation.externalId });
        setWakes(wakeResult.items); setWakeError('');
      } catch (reason) {
        setWakes([]); setWakeError(formatError(reason));
      }
      try {
        const memeResult = await api.controlChatbotConversation<{ items: ChatbotMemeSummary[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'memeList', externalId: selectedConversation.externalId });
        setMemes(memeResult.items); setMemeError('');
      } catch (reason) { setMemes([]); setMemeError(formatError(reason)); }
      try {
        const slangResult = await api.controlChatbotConversation<{ items: ChatbotSlangCandidate[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'slangList', externalId: selectedConversation.externalId });
        setSlang(slangResult.items); setSlangError('');
      } catch (reason) { setSlang([]); setSlangError(formatError(reason)); }
      try {
        const voiceResult = await api.controlChatbotConversation<{ items: ChatbotVoiceSummary[] }>(selectedGroup.accountId, selectedGroup.id, { action: 'voiceList', externalId: selectedConversation.externalId });
        setVoices(voiceResult.items); setVoiceError('');
      } catch (reason) { setVoices([]); setVoiceError(formatError(reason)); }
    } catch (reason) {
      setStatus(null);
      setApprovals([]);
      setStatusError(reason instanceof ApiError && reason.status === 404 ? tr('会话策略已不存在或会话ID已变更，请刷新会话列表。') : formatError(reason));
    }
  }, [selectedGroup, selectedConversation, tr]);
  useEffect(() => { void refresh(); }, [refresh]);
  const runControl = async (payload: Record<string, unknown>) => {
    if (!selectedGroup || !selectedConversation) return;
    setBusy(true);
    try {
      const result = await api.controlChatbotConversation<unknown>(selectedGroup.accountId, selectedGroup.id, { ...payload, externalId: selectedConversation.externalId });
      if (typeof payload.action === 'string' && payload.action.startsWith('voice')) setVoiceError('');
      if (payload.action === 'approvalDecision' && result && typeof result === 'object' && Array.isArray((result as { messages?: unknown }).messages)) {
        const output = ((result as { messages: unknown[] }).messages).filter((item): item is string => typeof item === 'string');
        if (output.length) message.info(output.join('\n'));
      }
      await refresh();
      return result;
    } catch (reason) {
      if (typeof payload.action === 'string' && payload.action.startsWith('voice')) setVoiceError(formatError(reason));
      onError(reason); return undefined;
    }
    finally { setBusy(false); }
  };
  const uploadVoice = async (file: File): Promise<void> => {
    if (!selectedGroup) return;
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setVoiceError(tr('语音文件为空或超过 5 MiB。'));
      return;
    }
    const contentType = file.type === 'audio/mpeg' || file.type === 'audio/wav'
      ? file.type
      : file.name.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : file.name.toLowerCase().endsWith('.wav') ? 'audio/wav' : file.type;
    setBusy(true);
    setVoiceError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
      await api.controlChatbotConversation(selectedGroup.accountId, selectedGroup.id, {
        action: 'voiceUpload', externalId: selectedConversation?.externalId, voiceName: file.name, voiceContentType: contentType, voiceData: btoa(binary),
      });
      await refresh();
    } catch (reason) {
      setVoiceError(formatError(reason));
      onError(reason);
    } finally { setBusy(false); }
  };
  const approvalColumns: TableColumnsType<ChatbotConversationStatus['pendingApprovals'][number]> = [
    { title: tr('审批 ID'), dataIndex: 'id', key: 'id', ellipsis: true },
    { title: tr('工具'), dataIndex: 'tool', key: 'tool' },
    { title: tr('请求者'), dataIndex: 'requestedBy', key: 'requestedBy' },
    { title: tr('状态'), dataIndex: 'status', key: 'status', render: (value: string) => <Tag>{tr(value === 'pending' ? '待审批' : value)}</Tag> },
    { title: tr('操作'), key: 'actions', render: (_, row) => row.status === 'pending' ? <Space><Popconfirm title={tr('批准后会在当前会话继续执行该工具，并产生模型/API调用。继续？')} okText={tr('批准')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'approvalDecision', approvalId: row.id, decision: 'approve' })}><Button size="small" type="primary" loading={busy}>{tr('批准')}</Button></Popconfirm><Popconfirm title={tr('拒绝此工具请求？')} okText={tr('拒绝')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'approvalDecision', approvalId: row.id, decision: 'reject' })}><Button size="small" danger loading={busy}>{tr('拒绝')}</Button></Popconfirm></Space> : <span className="muted">—</span> },
  ];
  const wakeColumns: TableColumnsType<ChatbotWake> = [
    { title: tr('计划唤醒'), dataIndex: 'reason', key: 'reason' },
    { title: tr('执行时间'), dataIndex: 'dueAt', key: 'dueAt', render: (value: number) => prettyDate(value) },
    { title: tr('操作'), key: 'actions', render: (_, row) => <Popconfirm title={tr('确定取消此计划唤醒？')} okText={tr('取消唤醒')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'wakeCancel', wakeId: row.id })}><Button size="small" danger>{tr('取消唤醒')}</Button></Popconfirm> },
  ];
  const slangColumns: TableColumnsType<ChatbotSlangCandidate> = [
    { title: tr('群聊用语'), dataIndex: 'term', key: 'term' },
    { title: tr('状态'), dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'confirmed' ? 'success' : value === 'rejected' ? 'error' : 'processing'}>{tr(value === 'confirmed' ? '已确认' : value === 'rejected' ? '已拒绝' : '待审核')}</Tag> },
    { title: tr('命中/人数'), key: 'evidence', render: (_, row) => `${row.hits} / ${row.distinctUsers}` },
    { title: tr('释义'), dataIndex: 'meaning', key: 'meaning', render: (value: string | undefined, row) => value || row.definition || tr('尚未研究') },
    { title: tr('操作'), key: 'actions', render: (_, row) => row.status === 'pending' ? <Space><Button size="small" type="primary" loading={busy} onClick={() => void runControl({ action: 'slangApprove', slangId: row.id })}>{tr('确认用语')}</Button><Button size="small" danger loading={busy} onClick={() => void runControl({ action: 'slangReject', slangId: row.id })}>{tr('拒绝')}</Button><Button size="small" loading={busy} onClick={() => void runControl({ action: 'slangDelete', slangId: row.id })}>{tr('删除')}</Button></Space> : row.status === 'rejected' ? <Button size="small" danger onClick={() => void runControl({ action: 'slangDelete', slangId: row.id })}>{tr('删除')}</Button> : <span className="muted">—</span> },
  ];
  const memeColumns: TableColumnsType<ChatbotMemeSummary> = [
    { title: tr('素材名称'), dataIndex: 'name', key: 'name' },
    { title: tr('图片类型'), dataIndex: 'contentType', key: 'contentType' },
    { title: tr('大小'), dataIndex: 'size', key: 'size', render: (size: number) => `${(size / 1024).toFixed(1)} KB` },
    { title: tr('创建者'), dataIndex: 'createdBy', key: 'createdBy' },
    { title: tr('操作'), key: 'actions', render: (_, item) => <Popconfirm title={tr('删除这个表情素材？')} okText={tr('删除')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'memeDelete', memeName: item.name })}><Button size="small" danger loading={busy}>{tr('删除')}</Button></Popconfirm> },
  ];
  const voiceColumns: TableColumnsType<ChatbotVoiceSummary> = [
    { title: tr('素材名称'), dataIndex: 'name', key: 'name' },
    { title: tr('语音类型'), dataIndex: 'contentType', key: 'contentType' },
    { title: tr('大小'), dataIndex: 'size', key: 'size', render: (size: number) => `${(size / 1024).toFixed(1)} KB` },
    { title: tr('创建者'), dataIndex: 'createdBy', key: 'createdBy' },
    { title: tr('操作'), key: 'actions', render: (_, item) => <Popconfirm title={tr('删除这个语音素材？')} okText={tr('删除')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'voiceDelete', voiceName: item.name })}><Button size="small" danger loading={busy}>{tr('删除')}</Button></Popconfirm> },
  ];
  return <section className="data-page chatbot-runtime-page">
    <Card className="runtime-control-card" title={tr('选择会话')} extra={<Space>
      {selectedGroup && <Button size="small" icon={<SettingOutlined />} onClick={() => onNavigate('groups')}>{tr('打开群聊策略')}</Button>}
      <Button icon={<ReloadOutlined />} onClick={() => { setConversationListRevision((value) => value + 1); void refresh(); }}>{tr('刷新会话列表')}</Button>
      {selectedConversation && <Button size="small" onClick={() => void refresh()}>{tr('刷新状态')}</Button>}
    </Space>}>
      <Select className="full-width" loading={conversationLoading} value={selectedConversationKey || undefined} onChange={setSelectedConversationKey} placeholder={tr('选择账号和会话')} notFoundContent={conversationLoading ? tr('正在加载会话…') : tr('没有可管理会话')} options={conversationTargets.map((item) => ({ value: JSON.stringify([item.id, item.externalId]), label: `${item.accountName} · ${item.name || item.externalId} · ${item.conversationType === 'private' ? tr('私聊') : tr('群聊')}${item.enabled ? '' : ` · ${tr('已停用')}`} · ${item.externalId}` }))} />
      {conversationListError && <Alert className="runtime-empty-alert" type="error" showIcon message={tr('会话列表读取失败')} description={conversationListError} action={<Button size="small" onClick={() => setConversationListRevision((value) => value + 1)}>{tr('重试')}</Button>} />}
      {!conversationLoading && !conversationListError && conversationTargets.length === 0 && <Alert className="runtime-empty-alert" type="info" showIcon message={tr('尚无可管理会话')} description={tr(groups.length ? '已存在会话策略，但没有有效的会话 ID。请在群聊策略中填写群聊或私聊 OpenID。' : accounts.length ? '会话列表来自已保存的群聊策略，不会自动发现历史聊天。请先创建策略并填写外部会话 ID。' : '请先配置平台账号，再创建群聊或私聊策略并填写外部会话 ID。')} action={<Space>
        <Button type="primary" size="small" onClick={() => onNavigate(accounts.length ? 'groups' : 'accounts')}>{tr(accounts.length ? '添加会话策略' : '配置平台账号')}</Button>
        <Button size="small" onClick={() => setConversationListRevision((value) => value + 1)}>{tr('刷新')}</Button>
      </Space>} />}
      {statusError && <Alert className="runtime-empty-alert" type="warning" showIcon message={tr('会话状态读取失败')} description={statusError} action={<Button size="small" onClick={() => { setConversationListRevision((value) => value + 1); void refresh(); }}>{tr('刷新')}</Button>} />}
      {status && <div className="runtime-status-grid">
        <div><span>{tr('会话策略')}</span><strong>{status.enabled ? tr('启用') : tr('已停用')}</strong></div><div><span>{tr('运行模式')}</span><strong>{status.mode}</strong></div><div><span>{tr('模型')}</span><strong>{status.model || '—'}</strong></div>
        <div><span>{tr('对话上下文')}</span><strong>{status.contextMessages}</strong></div><div><span>{tr('静默')}</span><strong>{status.silent ? tr('启用') : tr('停用')}</strong></div>
        <div><span>{tr('待审批工具')}</span><strong>{approvals.filter((item) => item.status === 'pending').length}</strong></div><div><span>{tr('待继续等待')}</span><strong>{status.pendingAgentWait ? tr('是') : tr('否')}</strong></div>
      </div>}
    </Card>
    {selectedGroup && status && <>
      <Card className="runtime-control-card" title={tr('会话设置')}>
        <p className="form-note">{tr('此处配置运行时设置；模型、供应商、白名单、预算、提示词和扩展策略请在群聊策略中配置。')} <Button type="link" onClick={() => onNavigate('groups')}>{tr('打开群聊策略')}</Button></p>
        <div className="runtime-control-row"><span>{tr('运行模式')}</span><Select value={mode} onChange={setMode} options={['chat', 'reserved', 'reserved2', 'closed-agent'].map((value) => ({ value, label: value }))} /><Button type="primary" loading={busy} onClick={() => void runControl({ action: 'mode', mode })}>{tr('保存模式')}</Button></div>
        <div className="runtime-control-row"><span>{tr('静默模式')}</span><Switch checked={silent} onChange={(value) => { setSilent(value); void runControl({ action: 'silent', silent: value }); }} checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></div>
        <label className="runtime-prompt-field"><span>{tr('一次性提示')} · {tr('只会在下一次模型请求中消费；留空后点击保存会清除。')}</span><Input.TextArea value={initialPrompt} maxLength={4000} showCount rows={3} onChange={(event) => setInitialPrompt(event.target.value)} /></label>
        <Space><Button loading={busy} onClick={() => void runControl({ action: 'initialPrompt', prompt: initialPrompt })}>{tr('保存一次性提示')}</Button><Button loading={busy} onClick={() => { setInitialPrompt(''); void runControl({ action: 'initialPrompt', prompt: null }); }}>{tr('清除提示')}</Button></Space>
        <label className="runtime-prompt-field"><span>{tr('额外禁用工具')} · {tr('每行填写一个工具名；只会减少会话策略允许的工具，不能在此提升权限。')}</span><Input.TextArea value={disabledToolsText} rows={3} onChange={(event) => setDisabledToolsText(event.target.value)} /></label>
        <Space><Button loading={busy} onClick={() => void runControl({ action: 'tools', disabledTools: disabledToolsText.split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean) })}>{tr('保存工具设置')}</Button><Popconfirm title={tr('清空当前会话上下文？')} okText={tr('清空')} cancelText={tr('返回')} onConfirm={() => void runControl({ action: 'reset' })}><Button danger loading={busy}>{tr('重置会话上下文')}</Button></Popconfirm></Space>
      </Card>
      <Card className="runtime-control-card" title={tr('待审批操作')} extra={<Text type="secondary">{tr('危险 MCP 操作仍需在目标 QQ 会话中由 owner 批准。')}</Text>}>
        <Table<ChatbotConversationStatus['pendingApprovals'][number]> rowKey="id" columns={approvalColumns} dataSource={approvals} pagination={false} locale={{ emptyText: tr('当前没有待审批操作') }} expandable={{ expandedRowRender: (row) => <div className="log-details"><h3>{tr('待执行工具参数')}</h3><DetailValue value={row.arguments ?? { unavailable: 'invalid_json' }} /></div> }} />
      </Card>
      <Card className="runtime-control-card" title={tr('计划唤醒')} extra={<Button size="small" onClick={() => void refresh()}>{tr('刷新')}</Button>}>
        {wakeError ? <Alert type="info" showIcon message={wakeError} description={tr('计划唤醒查询仅在提供持久唤醒存储的平台可用。')} /> : <Table<ChatbotWake> rowKey="id" columns={wakeColumns} dataSource={wakes} pagination={false} locale={{ emptyText: tr('当前会话没有计划唤醒') }} />}
      </Card>
      <Card className="runtime-control-card" title={tr('已审核表情素材')}>
        {memeError ? <Alert type="info" showIcon message={memeError} description={tr('当前平台未配置持久素材存储。')} /> : <Table<ChatbotMemeSummary> rowKey="name" columns={memeColumns} dataSource={memes} pagination={false} locale={{ emptyText: tr('当前会话还没有已审核表情。') }} />}
      </Card>
      <Card className="runtime-control-card" title={tr('账号语音素材库')} extra={<Button size="small" onClick={() => void refresh()}>{tr('刷新')}</Button>}>
        <p className="form-note">{tr('语音文件按账号共享，仅接受有效 MP3/WAV，单个文件最大 5 MiB。发送语音仍需在 QQ 会话中显式触发。')}</p>
        <label className="runtime-prompt-field"><span>{tr('上传 MP3 或 WAV')}</span><input aria-label={tr('上传 MP3 或 WAV')} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; if (file) void uploadVoice(file).finally(() => { input.value = ''; }); }} /></label>
        {voiceError ? <Alert type="warning" showIcon message={voiceError} description={tr('账号语音素材存储或请求失败；请检查 KV 配置、文件格式和大小。')} /> : <Table<ChatbotVoiceSummary> rowKey="name" columns={voiceColumns} dataSource={voices} pagination={false} locale={{ emptyText: tr('此账号还没有语音素材。') }} />}
      </Card>
      {(selectedConversation?.conversationType ?? selectedGroup.conversationType ?? 'group') === 'group' && <Card className="runtime-control-card" title={tr('群聊用语研究与审核')} extra={<Button size="small" onClick={() => void refresh()}>{tr('刷新')}</Button>}>
        <p className="form-note">{tr('仅达到群消息阈值的候选会进入研究流程；来源和群聊内容均为非可信数据。必须手动确认后才会进入模型提示词。')}</p>
        {slangError && <Alert type="warning" showIcon message={slangError} description={tr('以下为当前会话内的候选/已确认记录；搜索依赖Brave密钥，失败时候选保持待审核。')} />}
        <div className="form-grid two-cols"><Form.Item label={tr('用语')}><Input maxLength={80} value={slangTerm} onChange={(event) => setSlangTerm(event.target.value)} /></Form.Item><Form.Item label={tr('上下文证据')}><Input.TextArea rows={2} maxLength={1000} value={slangContext} onChange={(event) => setSlangContext(event.target.value)} /></Form.Item></div>
        <Button loading={busy} onClick={() => void runControl({ action: 'slangCreate', slangTerm, slangContext }).then((result) => { if (result) { setSlangTerm(''); setSlangContext(''); } })}>{tr('提交候选')}</Button>
        <Table<ChatbotSlangCandidate> rowKey="id" columns={slangColumns} dataSource={slang} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 850 }} locale={{ emptyText: tr('当前没有群聊用语候选。') }} expandable={{ expandedRowRender: (row) => <SlangReviewEditor candidate={row} onSave={(slangDetails) => void runControl({ action: 'slangUpdate', slangId: row.id, slangDetails })} /> }} />
      </Card>}
    </>}
  </section>;
}

function GroupsPage({ groups, plugins, accounts, providers, libraries, policies, onRefresh, onError }: {
  groups: GroupRecord[]; plugins: PluginRecord[]; accounts: BotAccountRecord[]; providers: ProviderRecord[]; libraries: LibraryData; policies: PolicyRecord[]; onRefresh: () => void; onError: (error: unknown) => void;
}) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = groups.find((item) => item.id === drawer.editingId);
  const selectedAccountId = (Form.useWatch('accountId', { form, preserve: true }) as string | undefined) ?? editing?.accountId;
  const conversationType = (Form.useWatch('conversationType', { form, preserve: true }) as GroupRecord['conversationType']) ?? editing?.conversationType ?? 'group';
  const selectedAccount = accounts.find((item) => item.id === selectedAccountId);
  const selectedPlugin = plugins.find((item) => item.id === selectedAccount?.pluginId);
  const definition = pluginDefinition(selectedPlugin?.type);
  // 私聊白名单只对私聊有意义；群聊的可达范围就是上面的群 ID 列表。
  const visibleConversationFields = conversationFields(definition?.type).filter((field) => field.key !== 'bridge_allowed_private' || conversationType === 'private');
  const identityPolicyId = (Form.useWatch('identityPolicyId', { form, preserve: true }) as string | undefined) ?? editing?.identityPolicyId;
  const identityPolicy = policies.find((item) => item.type === 'identity' && item.id === identityPolicyId && item.enabled);
  const effectiveProviderId = (Form.useWatch('providerId', { form, preserve: true }) as string | undefined) || editing?.providerId || identityPolicy?.providerId || '';
  const provider = providers.find((item) => item.id === effectiveProviderId);
  const promptMode = (Form.useWatch('systemPromptMode', { form, preserve: true }) as GroupRecord['systemPromptMode'] | undefined) ?? editing?.systemPromptMode ?? 'inherit';
  useEffect(() => {
    if (!drawer.open) return;
    const currentPlugin = plugins.find((item) => item.id === accounts.find((account) => account.id === editing?.accountId)?.pluginId);
    form.resetFields();
    form.setFieldsValue({
      accountId: editing?.accountId,
      externalIds: editing ? conversationIdList(editing.externalId) : [''],
      conversationType: editing?.conversationType ?? 'group',
      name: editing?.name ?? '', enabled: editing?.enabled ?? true,
      dialogPolicyId: editing?.dialogPolicyId || undefined,
      voicePolicyId: editing?.voicePolicyId || undefined,
      identityPolicyId: editing?.identityPolicyId || undefined,
      providerId: editing?.providerId || undefined, model: editing?.model || undefined,
      systemPromptMode: editing?.systemPromptMode ?? 'inherit',
      systemPrompt: editing?.systemPrompt ?? '', reasoningEffort: editing?.reasoningEffort ?? 'default',
      nonMentionReplyRate: editing?.nonMentionReplyRate ?? DEFAULT_NON_MENTION_REPLY_RATE,
      whitelistEnabled: editing?.whitelistEnabled ?? false,
      whitelistText: editing?.whitelistUserIds.join('\n') ?? '',
      dailyCostLimit: editing?.dailyCostLimit ?? 0, monthlyCostLimit: editing?.monthlyCostLimit ?? 0, totalCostLimit: editing?.totalCostLimit ?? 0,
      skillIds: editing?.skillIds ?? [], mcpIds: editing?.mcpIds ?? [], ruleIds: editing?.ruleIds ?? [],
      config: editableFieldValues(conversationFields(pluginDefinition(currentPlugin?.type)?.type), editing?.config),
    });
  }, [drawer.open, editing, form, plugins, accounts]);
  const save = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const userIds = typeof values.whitelistText === 'string' ? values.whitelistText.split(/[\s,，]+/).map((value) => value.trim()).filter(Boolean) : values.whitelistUserIds as string[] ?? [];
      const externalIds = conversationIdList(values.externalIds);
      await api.saveGroup({
        accountId: String(values.accountId), externalId: externalIds.join(','), name: String(values.name ?? ''),
        conversationType: values.conversationType as GroupRecord['conversationType'],
        config: { ...(editing?.config ?? {}), ...normalizeFieldValues(visibleConversationFields, values.config as JsonObject) },
        dialogPolicyId: String(values.dialogPolicyId ?? ''), voicePolicyId: String(values.voicePolicyId ?? ''), identityPolicyId: String(values.identityPolicyId ?? ''),
        enabled: Boolean(values.enabled), providerId: String(values.providerId ?? ''), model: String(values.model ?? ''),
        systemPromptMode: (values.systemPromptMode as GroupRecord['systemPromptMode']) ?? 'inherit',
        systemPrompt: String(values.systemPrompt ?? ''), reasoningEffort: values.reasoningEffort as GroupRecord['reasoningEffort'],
        nonMentionReplyRate: Number(values.nonMentionReplyRate ?? DEFAULT_NON_MENTION_REPLY_RATE),
        whitelistEnabled: Boolean(values.whitelistEnabled), whitelistUserIds: userIds,
        dailyCostLimit: Number(values.dailyCostLimit ?? 0), monthlyCostLimit: Number(values.monthlyCostLimit ?? 0), totalCostLimit: Number(values.totalCostLimit ?? 0),
        skillIds: values.skillIds as string[] ?? [], mcpIds: values.mcpIds as string[] ?? [], ruleIds: values.ruleIds as string[] ?? [],
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<GroupRecord> = [
    { title: tr('群聊'), dataIndex: 'name', key: 'name', render: (name: string, row) => {
      const ids = conversationIdList(row.externalId);
      return <div className="table-identity"><span className="identity-icon"><TeamOutlined /></span><span><strong>{name || ids[0] || row.id}</strong><small>{ids[0] ?? ''}{ids.length > 1 ? ` +${ids.length - 1}` : ''} / {row.id}</small></span></div>;
    } },
    { title: tr('会话类型'), dataIndex: 'conversationType', key: 'conversationType', render: (value: string) => <Tag>{value === 'private' ? tr('私聊') : tr('群聊')}</Tag> },
    { title: tr('账号'), dataIndex: 'accountId', key: 'accountId', render: (id: string) => accounts.find((item) => item.id === id)?.name ?? id },
    { title: tr('模型'), dataIndex: 'model', key: 'model', render: (model: string, row) => {
      const identity = policies.find((item) => item.type === 'identity' && item.id === row.identityPolicyId);
      const resolved = model || identity?.model || '';
      return <span className="model-cell">{resolved || tr('未配置')}<small>{providers.find((item) => item.id === (row.providerId || identity?.providerId))?.name ?? ''}</small></span>;
    } },
    { title: tr('策略'), key: 'policies', render: (_, row) => {
      const names = [
        policyName(policies, 'identity', row.identityPolicyId),
        policyName(policies, 'dialog', row.dialogPolicyId),
        policyName(policies, 'voice', row.voicePolicyId),
      ].filter(Boolean);
      return names.length ? <div className="model-tags">{names.map((name) => <Tag key={name}>{name}</Tag>)}</div> : <span className="muted">{tr('未选择')}</span>;
    } },
    { title: tr('非 @ 回复率'), dataIndex: 'nonMentionReplyRate', key: 'nonMentionReplyRate', render: (value: number) => <span className="table-mono">{((value ?? DEFAULT_NON_MENTION_REPLY_RATE) * 100).toFixed(0)}%</span> },
    { title: tr('白名单'), dataIndex: 'whitelistEnabled', key: 'whitelistEnabled', render: (enabled: boolean, row) => <span>{enabled ? `${tr('启用')} / ${row.whitelistUserIds.length}` : tr('未启用')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name || row.externalId}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveGroup({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除')}“${row.name || row.externalId}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteGroup(row.id).then(onRefresh).catch(onError)}><Button aria-label={tr('删除')} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  const choices = (kind: LibraryKind) => libraries[kind].map((item) => ({ label: `${item.name}${item.enabled ? '' : ` · ${tr('已停用')}`}`, value: item.id }));
  const policyOptions = (type: PolicyType) => policies.filter((item) => item.type === type).map((item) => ({ label: `${item.name}${item.enabled ? '' : ` · ${tr('已停用')}`}`, value: item.id }));
  return <section className="data-page"><PageToolbar count={groups.length} noun="GROUP POLICIES" action={tr('新增群聊策略')} onCreate={() => drawer.edit()} />
    {groups.length ? <Table<GroupRecord> rowKey="id" columns={columns} dataSource={groups} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 1050 }} className="data-table" /> : <EmptyTable title={tr('还没有群聊策略')} description={tr('新增群聊并为其绑定 AI 模型、回复策略和工具。')} onCreate={() => drawer.edit()} action={tr('新增群聊策略')} />}
    <Drawer title={<DrawerTitle label="GROUP POLICY" title={editing ? tr('编辑群聊策略') : tr('新增群聊策略')} />} width={660} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存策略')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <div className="form-grid two-cols">
          <Form.Item name="accountId" label={tr('机器人账号')} rules={[{ required: true, message: tr('请选择机器人账号') }]}><Select disabled={Boolean(editing)} placeholder={tr('选择账号')} options={accounts.map((item) => ({ label: `${item.name} · ${plugins.find((plugin) => plugin.id === item.pluginId)?.name ?? item.pluginId}`, value: item.id }))} onChange={(accountId: string) => {
            const nextPlugin = plugins.find((item) => item.id === accounts.find((account) => account.id === accountId)?.pluginId);
            form.setFieldValue('config', editableFieldValues(pluginDefinition(nextPlugin?.type)?.groupFields ?? [], accountId === editing?.accountId ? editing.config : {}));
          }} /></Form.Item>
          <Form.Item name="conversationType" label={tr('会话类型')} extra={tr('群聊绑定群 openid；私聊绑定用户 openid。')}><Select disabled={Boolean(editing)} options={[{ value: 'group', label: tr('群聊') }, { value: 'private', label: tr('私聊') }]} /></Form.Item>
        </div>
        <Form.Item label={conversationType === 'private' ? tr('允许的用户 openid') : tr('允许的群 ID')} required extra={tr('一条策略可服务多个会话；每个会话的历史、记忆与语音状态仍分别保存。')}>
          <Form.List name="externalIds" rules={[{ validator: async (_, value: string[] | undefined) => {
            if (!Array.isArray(value) || !value.some((item) => String(item ?? '').trim())) throw new Error(tr('请至少填写一个 openid'));
          } }]}>
            {(fields, { add, remove }, { errors }) => <div className="id-list">
              {fields.map(({ key, name, ...restField }) => <div className="id-list-row" key={key}>
                <Form.Item {...restField} name={name} rules={[{ required: true, whitespace: true, message: tr('请输入 openid') }]}>
                  <Input placeholder={conversationType === 'private' ? 'user-openid' : 'group-openid'} />
                </Form.Item>
                <Button type="text" danger aria-label={tr('移除')} icon={<MinusCircleOutlined />} disabled={fields.length <= 1} onClick={() => remove(name)} />
              </div>)}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add('')}>{conversationType === 'private' ? tr('添加用户 openid') : tr('添加群 ID')}</Button>
              <Form.ErrorList errors={errors} />
            </div>}
          </Form.List>
        </Form.Item>
        {editing && <p className="form-note">{tr('账号与会话类型创建后不可变更；会话 ID 可随时增减。')}</p>}
        {selectedAccountId && (visibleConversationFields.length ? <SchemaFields fields={visibleConversationFields} path="config" editing={Boolean(editing)} /> : <Alert type="info" showIcon message={tr('该插件类型没有声明群聊配置项。')} />)}
        <Form.Item name="name" label={tr('群聊名称')}><Input placeholder={tr('可选的群聊备注名称')} /></Form.Item>
        <div className="form-section-heading"><span>CAPABILITY POLICIES</span><small>INHERIT SHARED VALUES</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="identityPolicyId" label={tr('身份策略')} extra={tr('提供模型、提示词、Skills/MCP/Rules 与会话上下文默认值。')}><Select allowClear placeholder={tr('未选择')} options={policyOptions('identity')} /></Form.Item>
          <Form.Item name="dialogPolicyId" label={tr('对话策略')} extra={tr('提供流式响应、工具轮数、输出上限与回复随机性。')}><Select allowClear placeholder={tr('未选择')} options={policyOptions('dialog')} /></Form.Item>
          <Form.Item name="voicePolicyId" label={tr('语音策略')} extra={tr('提供语音合成模型、音色与语音大小限制。')}><Select allowClear placeholder={tr('未选择')} options={policyOptions('voice')} /></Form.Item>
        </div>
        <p className="form-note">{tr('选择策略后无需重复填写相同参数；未选择的项沿用插件级默认值。')} <Button type="link" href="#/admin/integrations">{tr('管理策略')}</Button></p>
        <div className="form-section-heading"><span>MODEL OVERRIDE</span><small>OPTIONAL</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="providerId" label={tr('AI供应商覆盖')}><Select allowClear placeholder={tr('继承身份策略')} options={providers.filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
          <Form.Item name="model" label={tr('模型覆盖')}><AutoComplete options={provider?.models.map((model) => ({ label: model, value: model })) ?? []} placeholder={tr('继承身份策略或输入模型 ID')} filterOption /></Form.Item>
        </div>
        <Form.Item name="reasoningEffort" label={tr('思考强度覆盖')} extra={tr('默认继承身份策略；模型默认表示不发送该参数。')}><Select options={[{ label: tr('继承身份策略'), value: 'default' }, { label: tr('低 / low'), value: 'low' }, { label: tr('中 / medium'), value: 'medium' }, { label: tr('高 / high'), value: 'high' }]} /></Form.Item>
        <div className="form-section-heading"><span>PROMPT OVERRIDE</span><small>INHERIT / APPEND / REPLACE</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="systemPromptMode" label={tr('提示词处理方式')} extra={promptMode === 'append' ? tr('身份策略提示词在前，本会话提示词在后。') : promptMode === 'override' ? tr('仅使用本会话提示词。') : tr('未选择身份策略时使用本会话提示词。')}><Select options={[{ value: 'inherit', label: tr('继承') }, { value: 'append', label: tr('附加') }, { value: 'override', label: tr('覆盖') }]} /></Form.Item>
          <Form.Item name="nonMentionReplyRate" label={tr('未 @ 回复概率')}><InputNumber className="full-width" min={0} max={1} step={0.01} precision={2} addonAfter="0–1" /></Form.Item>
        </div>
        <Form.Item name="systemPrompt" label={tr('本会话提示词')}><Input.TextArea rows={4} placeholder={tr('描述该群聊中 AI 的角色、边界与回复风格')} /></Form.Item>
        <div className="form-note">{tr('默认值 0.05；0 表示仅在被 @ 时回复，1 表示每条消息均参与回复判定。')}</div>
        <div className="form-section-heading"><span>SPENDING LIMITS</span><small>USD / 0 = UNLIMITED</small></div>
        <div className="form-grid two-cols">
          <Form.Item name="dailyCostLimit" label={tr('每日限额')}><InputNumber className="full-width" min={0} precision={2} addonBefore="$" /></Form.Item>
          <Form.Item name="monthlyCostLimit" label={tr('每月限额')}><InputNumber className="full-width" min={0} precision={2} addonBefore="$" /></Form.Item>
          <Form.Item name="totalCostLimit" label={tr('总限额')}><InputNumber className="full-width" min={0} precision={2} addonBefore="$" /></Form.Item>
        </div>
        <div className="form-note">{tr('限额使用 USD 计价；数值 0 表示不设限。任一预算到达限额后，运行时将根据策略停止额外模型请求。')}</div>
        <div className="form-section-heading"><span>ACCESS CONTROL</span><small>OPTIONAL WHITELIST</small></div>
        <Form.Item name="whitelistEnabled" label={tr('启用用户白名单')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
        <Form.Item name="whitelistText" label={tr('允许的用户 ID')} extra={tr('使用空格或逗号分隔。白名单关闭时此列表不会生效。')}><Input.TextArea rows={3} placeholder="user-id-1, user-id-2" /></Form.Item>
        <div className="form-section-heading"><span>EXTENSIONS</span><small>ADDED ON TOP OF THE IDENTITY POLICY</small></div>
        <Form.Item name="skillIds" label="Skills" extra={tr('在身份策略的基础上追加。')}><Select mode="multiple" placeholder={tr('选择可用 Skills')} options={choices('skills')} /></Form.Item>
        <Form.Item name="mcpIds" label="MCP" extra={tr('在身份策略的基础上追加。')}><Select mode="multiple" placeholder={tr('选择 MCP 服务')} options={choices('mcps')} /></Form.Item>
        <Form.Item name="ruleIds" label="Rules" extra={tr('在身份策略的基础上追加。')}><Select mode="multiple" placeholder={tr('选择规则集')} options={choices('rules')} /></Form.Item>
        <Form.Item name="enabled" label={tr('启用此群聊策略')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </section>;
}

function ProjectMemoriesPanel({ data, accounts, onRefresh, onError }: { data: ProjectMemoryRecord[]; accounts: BotAccountRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr, language } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const editing = data.find((item) => item.id === drawer.editingId);
  const visible = data.filter((item) => !query || `${item.name} ${item.title} ${item.desc} ${item.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ accountId: editing?.accountId ?? accounts[0]?.id, type: editing?.type ?? 'project', name: editing?.name ?? '', title: editing?.title ?? '', desc: editing?.desc ?? '', content: editing?.content ?? '', time: editing?.time ?? new Date().toISOString() });
  }, [drawer.open, editing, accounts, form]);
  const save = async (values: { accountId: string; type: MemoryType; name: string; title: string; desc?: string; content: string; time: string }) => {
    setSaving(true);
    try {
      await api.saveProjectMemory({ accountId: values.accountId, type: values.type, name: values.name, title: values.title, desc: values.desc ?? '', content: values.content, time: values.time }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<ProjectMemoryRecord> = [
    { title: tr('项目记忆'), dataIndex: 'title', key: 'title', render: (title: string, row) => <div className="table-identity"><span className="identity-icon"><DatabaseOutlined /></span><span><strong>{title}</strong><small>{accounts.find((account) => account.id === row.accountId)?.name ?? row.accountId} · {row.name}</small></span></div> },
    { title: tr('类型'), dataIndex: 'type', key: 'type', render: (value: MemoryType) => tr(({ user: '用户偏好', feedback: '反馈', project: '项目', reference: '参考资料' } as Record<MemoryType, string>)[value]) },
    { title: tr('说明'), dataIndex: 'desc', key: 'desc', ellipsis: true },
    { title: tr('更新时间'), dataIndex: 'time', key: 'time', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', render: (_, row) => <Space><Button size="small" icon={<EditOutlined />} aria-label={`${tr('编辑')} ${row.name}`} onClick={() => drawer.edit(row.id)} /><Popconfirm title={`${tr('删除')}“${row.title}”？`} okText={tr('删除')} cancelText={tr('返回')} onConfirm={() => void api.deleteProjectMemory(row.accountId, row.id).then(onRefresh).catch(onError)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={visible.length} noun="PROJECT MEMORIES" action={tr('新增记忆')} onCreate={() => drawer.edit()} />
    <Input allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('搜索记忆名称、标题或正文')} aria-label={tr('搜索记忆')} className="memory-search" />
    {visible.length ? <Table<ProjectMemoryRecord> rowKey="id" dataSource={visible} columns={columns} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 850 }} className="data-table" expandable={{ expandedRowRender: (row) => <div className="log-details"><h3>{tr('项目记忆内容')}</h3><DetailValue value={row.content} /></div> }} /> : <EmptyTable title={tr('还没有项目记忆')} description={tr('按账号存储可由所选会话检索的共享记忆。')} onCreate={() => drawer.edit()} action={tr('新增记忆')} />}
    <Drawer title={<DrawerTitle label="PROJECT MEMORY" title={editing ? tr('编辑记忆') : tr('新增记忆')} />} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('返回')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="accountId" label={tr('所属账号')} rules={[{ required: true, message: tr('请选择账号') }]}><Select disabled={Boolean(editing)} options={accounts.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="type" label={tr('类型')} rules={[{ required: true }]}><Select options={[{ value: 'user', label: tr('用户偏好') }, { value: 'feedback', label: tr('反馈') }, { value: 'project', label: tr('项目') }, { value: 'reference', label: tr('参考资料') }]} /></Form.Item>
        <Form.Item name="name" label={tr('记忆名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="title" label={tr('标题')} rules={[{ required: true, message: tr('请输入标题') }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="desc" label={tr('说明')}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        <Form.Item name="content" label={tr('记忆内容')} rules={[{ required: true, message: tr('请输入内容') }]}><Input.TextArea rows={8} showCount maxLength={20000} /></Form.Item>
        <Form.Item name="time" label={tr('记录时间')} rules={[{ required: true }]}><Input /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function IntegrationsPage({ providers, prices, libraries, policies, accounts, memories, onRefresh, onError }: { providers: ProviderRecord[]; prices: ModelPriceRecord[]; libraries: LibraryData; policies: PolicyRecord[]; accounts: BotAccountRecord[]; memories: ProjectMemoryRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const count = (type: PolicyType) => policies.filter((item) => item.type === type).length;
  return <section className="data-page integrations-page"><Tabs className="integration-tabs" items={[
    { key: 'providers', label: <span><ApiOutlined /> {tr('AI供应商')} <Tag>{providers.length}</Tag></span>, children: <ProvidersPanel data={providers} onRefresh={onRefresh} onError={onError} /> },
    { key: 'prices', label: <span><DatabaseOutlined /> {tr('单价')} <Tag>{prices.length}</Tag></span>, children: <PricesPanel data={prices} onRefresh={onRefresh} onError={onError} /> },
    { key: 'identity', label: <span><SafetyCertificateOutlined /> {tr('身份')} <Tag>{count('identity')}</Tag></span>, children: <PolicyPanel type="identity" data={policies} providers={providers} libraries={libraries} onRefresh={onRefresh} onError={onError} /> },
    { key: 'dialog', label: <span><ThunderboltOutlined /> {tr('对话')} <Tag>{count('dialog')}</Tag></span>, children: <PolicyPanel type="dialog" data={policies} providers={providers} libraries={libraries} onRefresh={onRefresh} onError={onError} /> },
    { key: 'voice', label: <span><MessageOutlined /> {tr('语音')} <Tag>{count('voice')}</Tag></span>, children: <PolicyPanel type="voice" data={policies} providers={providers} libraries={libraries} onRefresh={onRefresh} onError={onError} /> },
    { key: 'memories', label: <span><BookOutlined /> {tr('记忆')} <Tag>{memories.length}</Tag></span>, children: <ProjectMemoriesPanel data={memories} accounts={accounts} onRefresh={onRefresh} onError={onError} /> },
    ...(['skills', 'mcps', 'rules'] as LibraryKind[]).map((kind) => ({ key: kind, label: <span><ToolOutlined /> {tr(libraryNames[kind])} <Tag>{libraries[kind].length}</Tag></span>, children: <LibraryPanel kind={kind} data={libraries[kind]} onRefresh={onRefresh} onError={onError} /> })),
  ]} />
  </section>;
}

function policySummary(type: PolicyType, policy: PolicyRecord, providers: ProviderRecord[]): string {
  const config = policy.config ?? {};
  const value = (key: string, fallback: string) => (typeof config[key] === 'string' ? config[key] as string : fallback);
  const count = (key: string, fallback: number) => (typeof config[key] === 'number' ? config[key] as number : fallback);
  if (type === 'dialog') {
    return [config.agent_stream === true ? 'stream' : 'buffered', `${count('agent_max_rounds', 5)} rounds`, `${count('agent_max_output_tokens', 4096)} tok`, `T ${count('agent_temperature', 0.7)}`].join(' · ');
  }
  if (type === 'voice') {
    return [value('voice_model', '—'), value('voice_id', 'alloy'), `${count('voice_speed', 1)}x`, `${count('voice_max_text_chars', 500)} chars`].join(' · ');
  }
  const provider = providers.find((item) => item.id === policy.providerId);
  return [policy.model || '—', provider?.name ?? '', policy.reasoningEffort && policy.reasoningEffort !== 'default' ? policy.reasoningEffort : 'model default',
    `Skills ${policy.skillIds?.length ?? 0} / MCP ${policy.mcpIds?.length ?? 0} / Rules ${policy.ruleIds?.length ?? 0}`].filter(Boolean).join(' · ');
}

function PolicyPanel({ type, data, providers, libraries, onRefresh, onError }: {
  type: PolicyType; data: PolicyRecord[]; providers: ProviderRecord[]; libraries: LibraryData; onRefresh: () => void; onError: (error: unknown) => void;
}) {
  const { language, tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const fields = useMemo(() => policyFields(type), [type]);
  const rows = data.filter((item) => item.type === type);
  const editing = rows.find((item) => item.id === drawer.editingId);
  const isIdentity = type === 'identity';
  const providerId = (Form.useWatch('providerId', { form, preserve: true }) as string | undefined) || editing?.providerId;
  const provider = providers.find((item) => item.id === providerId);
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      enabled: editing?.enabled ?? true,
      providerId: editing?.providerId || undefined,
      model: editing?.model || undefined,
      reasoningEffort: editing?.reasoningEffort ?? 'default',
      systemPrompt: editing?.systemPrompt ?? '',
      skillIds: editing?.skillIds ?? [], mcpIds: editing?.mcpIds ?? [], ruleIds: editing?.ruleIds ?? [],
      config: editableFieldValues(fields, editing?.config),
    });
  }, [drawer.open, editing, form, fields]);
  const save = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.savePolicy({
        type,
        name: String(values.name ?? ''),
        description: String(values.description ?? ''),
        enabled: Boolean(values.enabled),
        config: { ...(editing?.config ?? {}), ...normalizeFieldValues(fields, values.config as JsonObject) },
        ...(isIdentity ? {
          providerId: String(values.providerId ?? ''),
          model: String(values.model ?? ''),
          systemPrompt: String(values.systemPrompt ?? ''),
          reasoningEffort: values.reasoningEffort as PolicyRecord['reasoningEffort'],
          skillIds: values.skillIds as string[] ?? [], mcpIds: values.mcpIds as string[] ?? [], ruleIds: values.ruleIds as string[] ?? [],
        } : {}),
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const choices = (kind: LibraryKind) => libraries[kind].map((item) => ({ label: `${item.name}${item.enabled ? '' : ` · ${tr('已停用')}`}`, value: item.id }));
  const columns: TableColumnsType<PolicyRecord> = [
    { title: tr('名称'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><ThunderboltOutlined /></span><span><strong>{name}</strong><small>{row.description || row.id}</small></span></div> },
    { title: tr('概要'), key: 'summary', render: (_, row) => <span className="table-mono">{policySummary(type, row, providers)}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.savePolicy({ type: row.type, name: row.name, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除策略')}“${row.name}”？`} description={tr('仍被群聊引用的策略无法删除。')} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deletePolicy(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={rows.length} noun="CAPABILITY POLICIES" action={tr('新增策略')} onCreate={() => drawer.edit()} />
    {rows.length ? <Table<PolicyRecord> rowKey="id" columns={columns} dataSource={rows} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 820 }} className="data-table" /> : <EmptyTable title={tr('还没有策略')} description={`${tr('创建可复用的')}${tr(policyTypeNames[type])}${tr('，再在群聊策略中引用。')}`} onCreate={() => drawer.edit()} action={tr('创建策略')} />}
    <Drawer title={<DrawerTitle label="CAPABILITY POLICY" title={`${editing ? tr('编辑策略') : tr('新增策略')} · ${tr(policyTypeNames[type])}`} />} width={620} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存策略')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('策略名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input placeholder={tr('例如：群聊默认身份')} /></Form.Item>
        <Form.Item name="description" label={tr('策略说明')}><Input.TextArea rows={2} placeholder={tr('说明该策略的适用范围')} /></Form.Item>
        {isIdentity && <>
          <div className="form-grid two-cols">
            <Form.Item name="providerId" label={tr('AI供应商')}><Select allowClear placeholder={tr('沿用插件默认')} options={providers.filter((item) => item.enabled).map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
            <Form.Item name="model" label={tr('模型')}><AutoComplete options={provider?.models.map((model) => ({ label: model, value: model })) ?? []} placeholder={tr('选择或输入模型 ID')} filterOption /></Form.Item>
          </div>
          <Form.Item name="reasoningEffort" label={tr('思考强度')} extra={tr('模型默认不发送思考强度参数，适用于不支持该参数的模型。')}><Select options={[{ label: tr('模型默认'), value: 'default' }, { label: tr('低 / low'), value: 'low' }, { label: tr('中 / medium'), value: 'medium' }, { label: tr('高 / high'), value: 'high' }]} /></Form.Item>
          <Form.Item name="systemPrompt" label={tr('系统提示词')} extra={tr('项目记忆会叠加在该提示词之后，不会相互覆盖。')}><Input.TextArea rows={5} placeholder={tr('描述 AI 的角色、边界与回复风格')} /></Form.Item>
          <Form.Item name="skillIds" label="Skills"><Select mode="multiple" placeholder={tr('选择可用 Skills')} options={choices('skills')} /></Form.Item>
          <Form.Item name="mcpIds" label="MCP"><Select mode="multiple" placeholder={tr('选择 MCP 服务')} options={choices('mcps')} /></Form.Item>
          <Form.Item name="ruleIds" label="Rules"><Select mode="multiple" placeholder={tr('选择规则集')} options={choices('rules')} /></Form.Item>
        </>}
        <SchemaFields fields={fields} path="config" editing={Boolean(editing)} />
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function ProvidersPanel({ data, onRefresh, onError }: { data: ProviderRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  const models = Form.useWatch('models', { form, preserve: true }) as string[] | undefined;
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ name: editing?.name ?? '', baseUrl: editing?.baseUrl ?? '', apiKey: '', enabled: editing?.enabled ?? true, models: editing?.models ?? [], priceMultiplier: editing?.priceMultiplier ?? 1, mediaCapabilities: editing?.mediaCapabilities ?? ['image'] });
  }, [drawer.open, editing, form]);
  const save = async (values: { name: string; baseUrl: string; apiKey?: string; enabled: boolean; models?: string[]; priceMultiplier?: number; mediaCapabilities?: ProviderRecord['mediaCapabilities'] }) => {
    setSaving(true);
    try {
      await api.saveProvider({ name: values.name, baseUrl: values.baseUrl, ...(values.apiKey ? { apiKey: values.apiKey } : {}), enabled: values.enabled, models: values.models ?? [], priceMultiplier: values.priceMultiplier ?? 1, mediaCapabilities: values.mediaCapabilities ?? ['image'] }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const discoverModels = async () => {
    if (!editing) return;
    setDiscovering(true);
    try {
      const foundModels = await api.discoverModels(editing.id);
      form.setFieldValue('models', [...new Set([...(models ?? []), ...foundModels])]);
      if (foundModels.length === 0) onError(new Error(tr('供应商未返回可用模型')));
    } catch (reason) {
      onError(reason);
    } finally {
      setDiscovering(false);
    }
  };
  const columns: TableColumnsType<ProviderRecord> = [
    { title: tr('供应商'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><ApiOutlined /></span><span><strong>{name}</strong><small>{row.baseUrl}</small></span></div> },
    { title: tr('模型'), dataIndex: 'models', key: 'models', render: (values: string[]) => <div className="model-tags">{values.length ? values.slice(0, 3).map((value) => <Tag key={value}>{value}</Tag>) : <span className="muted">{tr('尚未登记')}</span>}{values.length > 3 && <span>+{values.length - 3}</span>}</div> },
    { title: tr('API 计价倍率'), dataIndex: 'priceMultiplier', key: 'priceMultiplier', align: 'right', render: (value?: number) => <span className="table-mono">× {value ?? 1}</span> },
    { title: tr('密钥'), dataIndex: 'apiKey', key: 'apiKey', render: (value: string) => value ? <span className="secret-mask">••••••••</span> : <span className="muted">{tr('未配置')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑供应商')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveProvider({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除供应商')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteProvider(row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun="OPENAI-COMPATIBLE PROVIDERS" action={tr('新增供应商')} onCreate={() => drawer.edit()} />
    {data.length ? <Table<ProviderRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 760 }} className="data-table" /> : <EmptyTable title={tr('还没有AI供应商')} description={tr('添加 OpenAI 兼容 API，并登记可用的模型 ID。')} onCreate={() => drawer.edit()} action={tr('添加供应商')} />}
    <Drawer title={<DrawerTitle label="MODEL PROVIDER" title={editing ? tr('编辑供应商') : tr('新增供应商')} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存供应商')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('供应商名称')} rules={[{ required: true, message: tr('请输入供应商名称') }]}><Input placeholder={tr('例如：团队模型网关')} /></Form.Item>
        <Form.Item name="baseUrl" label="API Base URL" rules={[{ required: true, message: tr('请输入 Base URL') }, { type: 'url', message: tr('请输入有效 URL') }]}><Input placeholder="https://api.example.com/v1" /></Form.Item>
        <Form.Item name="apiKey" label="API Key" extra={editing ? tr('为安全起见密钥不会回显；留空表示保持现有密钥。') : tr('密钥由服务端保存，请勿分享控制台截图。')}><Input.Password autoComplete="new-password" placeholder={editing ? tr('留空以保持现有密钥') : tr('输入 API Key')} /></Form.Item>
        <Form.Item name="priceMultiplier" label={tr('API 计价倍率')} extra={tr('默认 1。该 API 的模型成本按基础模型单价乘以此倍率估算。')} rules={[{ required: true, message: tr('此字段为必填项') }]}><InputNumber min={0} precision={4} step={0.1} className="full-width" addonBefore="×" /></Form.Item>
        <Form.Item name="mediaCapabilities" label={tr('API 媒体能力')} extra={tr('仅选择该供应商实际支持的能力。默认图片；清空表示仅使用文本，不会自动验证或承诺 API 支持。')}><Select mode="multiple" virtual={false} allowClear placeholder={tr('选择供应商支持的媒体能力')} options={[{ value: 'image', label: tr('图片') }, { value: 'audio', label: tr('音频') }, { value: 'video', label: tr('视频') }, { value: 'file', label: tr('文件') }, { value: 'speech', label: tr('语音合成') }]} /></Form.Item>
        <Form.Item name="models" label={tr('可用模型')} extra={tr('输入模型 ID 后按 Enter 添加。')}><Select mode="tags" tokenSeparators={[',', '，', ' ']} placeholder="gpt-4o-mini" /></Form.Item>
        <div className="discover-row"><Button icon={<ReloadOutlined />} loading={discovering} disabled={!editing} onClick={() => void discoverModels()}>{tr('自动获取模型')}</Button><span>{editing ? tr('通过服务端安全请求供应商 /models') : tr('请先保存供应商，再获取模型列表')}</span></div>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function PricesPanel({ data, onRefresh, onError }: { data: ModelPriceRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { tr } = useI18n();
  const { message } = AntApp.useApp();
  const drawer = useDrawer();
  const [form] = Form.useForm<ModelPriceRecord>();
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [presetIds, setPresetIds] = useState<string[]>([]);
  const editing = data.find((item) => item.id === drawer.editingId);
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({ name: editing?.name ?? '', model: editing?.model ?? '', inputCostPerMillion: editing?.inputCostPerMillion ?? 0, outputCostPerMillion: editing?.outputCostPerMillion ?? 0, cacheInputCostPerMillion: editing?.cacheInputCostPerMillion, unit: editing?.unit ?? 'tokens', sourceUrl: editing?.sourceUrl ?? '', enabled: editing?.enabled ?? true });
  }, [drawer.open, editing, form]);
  const save = async (values: Omit<ModelPriceRecord, 'cacheInputCostPerMillion'> & { cacheInputCostPerMillion?: number | null }) => {
    setSaving(true);
    try {
      await api.savePrice({ ...values, currency: 'USD' }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const importPresets = async () => {
    setImporting(true);
    let imported = 0;
    try {
      for (const preset of MODEL_PRICE_PRESETS.filter((item) => presetIds.includes(item.id) && !data.some((saved) => saved.model === item.model))) {
        await api.savePrice({ name: preset.name, model: preset.model, inputCostPerMillion: preset.inputCostPerMillion, outputCostPerMillion: preset.outputCostPerMillion, cacheInputCostPerMillion: preset.cacheInputCostPerMillion, currency: preset.currency, unit: preset.unit ?? 'tokens', sourceUrl: preset.sourceUrl, enabled: true });
        imported += 1;
      }
      message.success(`${tr('已导入预置单价')}：${imported}`);
      setPresetIds([]);
    } catch (reason) {
      onError(new Error(`${tr('已导入预置单价')}：${imported}；${formatError(reason)}`));
    } finally {
      setImporting(false);
      if (imported > 0) onRefresh();
    }
  };
  const columns: TableColumnsType<ModelPriceRecord> = [
    { title: tr('模型'), dataIndex: 'model', key: 'model', render: (value: string, row) => <div className="model-cell">{value}<small>{row.name}</small></div> },
    { title: tr('计价单位'), dataIndex: 'unit', key: 'unit', render: (value?: string) => value === 'characters' ? tr('百万字符') : tr('百万 token') },
    { title: tr('输入成本'), dataIndex: 'inputCostPerMillion', key: 'input', align: 'right', render: (value: number) => <span className="table-mono">${value}</span> },
    { title: tr('输出成本'), dataIndex: 'outputCostPerMillion', key: 'output', align: 'right', render: (value: number) => <span className="table-mono">${value}</span> },
    { title: tr('缓存输入单价'), dataIndex: 'cacheInputCostPerMillion', key: 'cache', align: 'right', render: (value?: number) => <span className="table-mono">{value === undefined ? '—' : `$${value}`}</span> },
    { title: tr('计价来源'), dataIndex: 'sourceUrl', key: 'source', ellipsis: true, render: (value?: string) => <span className="price-source" title={value}>{value || tr('手动登记')}</span> },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (value: boolean) => <StatusTag enabled={value} /> },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Button size="small" aria-label={`${tr('编辑')} ${row.model}`} icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /><Switch checked={row.enabled} aria-label={`${row.model} ${tr('启用状态')}`} onChange={(enabled) => void api.savePrice({ ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除模型单价')} ${row.model}？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deletePrice(row.id).then(onRefresh).catch(onError)}><Button danger size="small" aria-label={`${tr('删除')} ${row.model}`} icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun="USD / 1M UNITS" action={tr('新增模型单价')} onCreate={() => drawer.edit()} />
    <p className="form-note">{tr('预置为官方标准模型价格快照，不会自动更新；导入前请核对来源。')} {tr('核对日期')}：{MODEL_PRICE_CHECKED_AT}</p>
    <div className="preset-import"><Select mode="multiple" virtual={false} optionFilterProp="label" value={presetIds} onChange={setPresetIds} aria-label={tr('选择预置模型单价')} placeholder={tr('选择预置模型单价')} options={MODEL_PRICE_PRESETS.map((item) => ({ label: `${item.name} · $${item.inputCostPerMillion} / $${item.outputCostPerMillion}`, value: item.id, disabled: data.some((saved) => saved.model === item.model) }))} /><Button loading={importing} disabled={!presetIds.length} onClick={() => void importPresets()}>{tr('导入所选预置')}</Button></div>
    {data.length ? <Table<ModelPriceRecord> rowKey="id" dataSource={data} columns={columns} className="data-table" scroll={{ x: 1000 }} pagination={{ pageSize: 8, showSizeChanger: false }} /> : <EmptyTable title={tr('还没有模型单价')} description={tr('手动登记或选择官方预置导入，再在群聊选择模型。')} />}
    <Drawer title={<DrawerTitle label="MODEL PRICING" title={editing ? tr('编辑模型单价') : tr('新增模型单价')} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input /></Form.Item>
        <Form.Item name="model" label={tr('模型 ID')} extra={tr('与供应商模型 ID 对齐；精确匹配优先，也支持版本后缀。')} rules={[{ required: true, message: tr('此字段为必填项') }]}><Input /></Form.Item>
        <div className="form-grid two-cols">
          <Form.Item name="inputCostPerMillion" label={tr('输入成本')} rules={[{ required: true, message: tr('此字段为必填项') }]}><InputNumber min={0} precision={6} addonBefore="$" /></Form.Item>
          <Form.Item name="outputCostPerMillion" label={tr('输出成本')} rules={[{ required: true, message: tr('此字段为必填项') }]}><InputNumber min={0} precision={6} addonBefore="$" /></Form.Item>
          <Form.Item name="cacheInputCostPerMillion" label={tr('缓存输入单价')}><InputNumber min={0} precision={6} addonBefore="$" /></Form.Item>
        </div>
        <Form.Item name="unit" label={tr('计价单位')}><Select options={[{ value: 'tokens', label: tr('百万 token') }, { value: 'characters', label: tr('百万字符') }]} /></Form.Item>
        <p className="form-note">{tr('价格按 USD / 百万所选单位登记。缓存单价可选，未填写时使用标准输入单价。')}</p>
        <Form.Item name="sourceUrl" label={tr('来源地址')} rules={[{ type: 'url', message: tr('请输入有效 URL') }]}><Input /></Form.Item>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function DetailValue({ value, labels = {} }: { value: unknown; labels?: Record<string, string> }) {
  const { tr } = useI18n();
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value === 'boolean') return <span>{value ? tr('是') : tr('否')}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span className="detail-text">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ol className="detail-list">{value.map((item, index) => <li key={index}><DetailValue value={item} labels={labels} /></li>)}</ol> : <span className="muted">{tr('空列表')}</span>;
  if (typeof value === 'object') return <DetailFields values={value as JsonObject} labels={labels} />;
  return <span>{String(value)}</span>;
}

function DetailFields({ values, labels = {} }: { values: JsonObject; labels?: Record<string, string> }) {
  const { tr } = useI18n();
  const entries = Object.entries(values);
  const knownLabels: Record<string, string> = { userName: tr('用户昵称'), promptTokens: tr('输入 token'), completionTokens: tr('输出 token'), cachedPromptTokens: tr('缓存输入 token'), inputCharacters: tr('输入字符数'), conversationType: tr('会话类型'), messageId: tr('消息 ID'), seq: tr('发送序号') };
  return entries.length ? <dl className="detail-fields">{entries.map(([key, value]) => <div key={key}><dt>{labels[key] ?? knownLabels[key] ?? key}</dt><dd><DetailValue value={value} labels={labels} /></dd></div>)}</dl> : <span className="muted">{tr('没有详情字段')}</span>;
}

function LibraryPanel({ kind, data, onRefresh, onError }: { kind: LibraryKind; data: LibraryRecord[]; onRefresh: () => void; onError: (error: unknown) => void }) {
  const { language, tr } = useI18n();
  const drawer = useDrawer();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = data.find((item) => item.id === drawer.editingId);
  useEffect(() => {
    if (!drawer.open) return;
    form.resetFields();
    form.setFieldsValue({
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      enabled: editing?.enabled ?? true,
      config: {
        prompt: '', content: '', url: '',
        ...(editing?.config ?? {}),
        allowedTools: editing?.config.allowedTools ?? editing?.config.tools ?? [],
        authToken: '',
      },
    });
  }, [drawer.open, editing, form]);
  const save = async (values: { name: string; description?: string; enabled: boolean; config?: JsonObject }) => {
    setSaving(true);
    try {
      const fields = kind === 'mcps' ? ['url', 'authToken', 'allowedTools'] : kind === 'skills' ? ['prompt', 'content'] : ['content'];
      const config = { ...(editing?.config ?? {}) };
      for (const key of fields) {
        const value = values.config?.[key];
        if (key === 'authToken' && !value) continue;
        config[key] = value ?? (key === 'allowedTools' ? [] : '');
      }
      await api.saveLibrary(kind, {
        name: values.name,
        description: values.description ?? '',
        enabled: values.enabled,
        config,
      }, editing?.id);
      drawer.close(); onRefresh();
    } catch (reason) { onError(reason); }
    finally { setSaving(false); }
  };
  const columns: TableColumnsType<LibraryRecord> = [
    { title: tr('能力字段'), dataIndex: 'name', key: 'name', render: (name: string, row) => <div className="table-identity"><span className="identity-icon"><ToolOutlined /></span><span><strong>{name}</strong><small>{row.id}</small></span></div> },
    { title: tr('说明'), dataIndex: 'description', key: 'description', render: (value: string) => value || '—' },
    { title: tr('状态'), dataIndex: 'enabled', key: 'enabled', render: (enabled: boolean) => <StatusTag enabled={enabled} /> },
    { title: tr('更新于'), dataIndex: 'updatedAt', key: 'updatedAt', render: (value: string) => prettyDate(value, language) },
    { title: '', key: 'actions', align: 'right', render: (_, row) => <Space><Tooltip title={tr('编辑')}><Button aria-label={`${tr('编辑')} ${row.name}`} size="small" icon={<EditOutlined />} onClick={() => drawer.edit(row.id)} /></Tooltip><Switch checked={row.enabled} aria-label={`${row.name} ${tr('启用状态')}`} onChange={(enabled) => void api.saveLibrary(kind, { ...row, enabled }, row.id).then(onRefresh).catch(onError)} /><Popconfirm title={`${tr('删除')}“${row.name}”？`} okText={tr('删除')} cancelText={tr('取消')} onConfirm={() => void api.deleteLibrary(kind, row.id).then(onRefresh).catch(onError)}><Button aria-label={`${tr('删除')} ${row.name}`} danger size="small" icon={<DeleteOutlined />} /></Popconfirm></Space> },
  ];
  return <div className="tab-panel"><PageToolbar count={data.length} noun={libraryNames[kind].toUpperCase()} action={`${tr('新增')} ${libraryNames[kind]}`} onCreate={() => drawer.edit()} />
    {data.length ? <Table<LibraryRecord> rowKey="id" columns={columns} dataSource={data} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 760 }} className="data-table" /> : <EmptyTable title={`${tr('还没有')} ${libraryNames[kind]}`} description={`${tr('添加')} ${libraryNames[kind]}${tr('，再按群聊策略选择启用范围。')}`} onCreate={() => drawer.edit()} action={`${tr('新增')} ${libraryNames[kind]}`} />}
    <Drawer title={<DrawerTitle label={`${kind.toUpperCase()} / LIBRARY`} title={editing ? `${tr('编辑')} ${libraryNames[kind]}` : `${tr('新增')} ${libraryNames[kind]}`} />} width={560} open={drawer.open} onClose={drawer.close} destroyOnClose footer={<div className="drawer-footer"><Button onClick={drawer.close}>{tr('取消')}</Button><Button type="primary" loading={saving} onClick={() => form.submit()}>{tr('保存')}</Button></div>}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={save}>
        <Form.Item name="name" label={tr('名称')} rules={[{ required: true, message: tr('请输入名称') }]}><Input /></Form.Item>
        <Form.Item name="description" label={tr('说明')}><Input.TextArea rows={3} /></Form.Item>
        <div className="schema-fields">
          <div className="form-section-heading"><span>{tr('能力配置')}</span><small>{libraryNames[kind]}</small></div>
          {kind === 'skills' && <Form.Item name={['config', 'prompt']} label={tr('Skill 提示词')} extra={tr('为模型说明何时使用此能力，以及如何执行。')}><Input.TextArea rows={5} /></Form.Item>}
          {kind !== 'mcps' && <Form.Item name={['config', 'content']} label={kind === 'rules' ? tr('规则内容') : tr('Skill 内容')} extra={kind === 'rules' ? tr('规则将作为群聊模型上下文的一部分。') : tr('能力的详细步骤或参考内容，不需要填写 JSON。')}><Input.TextArea rows={7} /></Form.Item>}
          {kind === 'mcps' && <>
            <Form.Item name={['config', 'url']} label={tr('MCP 服务地址')} extra={tr('填写支持 HTTP 的 MCP 服务端点。')} rules={[{ required: true, message: tr('请输入有效 URL') }, { type: 'url', message: tr('请输入有效 URL') }]}><Input /></Form.Item>
            <Form.Item name={['config', 'authToken']} label={tr('MCP 访问令牌')} extra={tr('可选。令牌由服务端保存；编辑时留空保持原值。')}><Input.Password autoComplete="new-password" placeholder={editing ? tr('留空保持现有值') : undefined} /></Form.Item>
            <Form.Item name={['config', 'allowedTools']} label={tr('允许的 MCP 工具')} extra={tr('输入工具名称并按 Enter 添加；留空允许该服务的全部工具。')}><Select mode="tags" tokenSeparators={[',', '，', ' ']} /></Form.Item>
          </>}
          {editing && Object.keys(editing.config).some((key) => !(kind === 'mcps' ? ['url', 'authToken', 'allowedTools'] : kind === 'skills' ? ['prompt', 'content'] : ['content']).includes(key)) && <details className="legacy-fields"><summary>{tr('已有扩展字段（保存时保留）')}</summary><DetailFields values={Object.fromEntries(Object.entries(editing.config).filter(([key]) => !(kind === 'mcps' ? ['url', 'authToken', 'allowedTools'] : kind === 'skills' ? ['prompt', 'content'] : ['content']).includes(key)))} /></details>}
        </div>
        <Form.Item name="enabled" label={tr('启用状态')} valuePropName="checked"><Switch checkedChildren={tr('启用')} unCheckedChildren={tr('停用')} /></Form.Item>
      </Form>
    </Drawer>
  </div>;
}

function logFieldValue(row: ConversationLog, key: string): unknown {
  const direct = (row as unknown as JsonObject)[key];
  if (direct !== undefined) return direct;
  let value: unknown = row.details;
  for (const part of key.replace(/^details\./, '').split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as JsonObject)[part];
  }
  return value;
}

function LogsPage({ data, total, enabled, plugins, accounts, groups, page, onPage, form, onFilter }: {
  data: ConversationLog[]; total: number; enabled: boolean | null; plugins: PluginRecord[]; accounts: BotAccountRecord[]; groups: GroupRecord[]; page: number; onPage: (value: number) => void; form: FormInstance<LogFilters>; onFilter: (values: LogFilters) => void;
}) {
  const { language, tr, localized } = useI18n();
  const selectedPluginId = Form.useWatch('pluginId', { form, preserve: true }) as string | undefined;
  const rowPlugin = (row: ConversationLog) => plugins.find((item) => item.id === (row.pluginId || accounts.find((account) => account.id === row.accountId)?.pluginId));
  const rowDefinition = (row: ConversationLog) => pluginDefinition(row.pluginType || rowPlugin(row)?.type);
  const selectedDefinition = pluginDefinition(plugins.find((item) => item.id === selectedPluginId)?.type);
  const fields = new Map<string, { key: string; label: { zh: string; en: string } }>();
  for (const definition of selectedDefinition ? [selectedDefinition] : data.map(rowDefinition)) {
    for (const field of definition?.logFields ?? []) fields.set(field.key, field);
  }
  const label = (key: string, fallback: string) => fields.has(key) ? localized(fields.get(key)!.label) : tr(fallback);
  const fixedKeys = new Set(['id', 'createdAt', 'pluginId', 'pluginType', 'userId', 'groupExternalId', 'content', 'reply', 'status', 'expiresAt']);
  const columns: TableColumnsType<ConversationLog> = [
    { title: label('createdAt', '时间'), dataIndex: 'createdAt', key: 'createdAt', width: 180, render: (value: number) => prettyDate(value, language) },
    { title: label('pluginId', '插件'), key: 'plugin', width: 180, render: (_, row) => <div className="model-cell">{rowPlugin(row)?.name || row.pluginType || tr('未知插件')}<small>{row.pluginType || rowPlugin(row)?.type || row.pluginId || '—'}</small></div> },
    { title: label('userId', '用户 openid'), dataIndex: 'userId', key: 'userId', width: 180, render: (value: unknown) => typeof value === 'string' && value ? <Text className="detail-text" copyable={{ text: value, tooltips: [tr('复制 openid'), tr('已复制')] }}>{value}</Text> : <DetailValue value={value} /> },
    { title: label('groupExternalId', '群 openid'), dataIndex: 'groupExternalId', key: 'groupExternalId', width: 180, render: (value: unknown) => typeof value === 'string' && value ? <Text className="detail-text" copyable={{ text: value, tooltips: [tr('复制 openid'), tr('已复制')] }}>{value}</Text> : <DetailValue value={value} /> },
    { title: label('content', '收到内容'), dataIndex: 'content', key: 'content', width: 260, render: (value: unknown) => <div className="log-content"><DetailValue value={value} /></div> },
    { title: label('reply', '发送内容'), key: 'reply', width: 320, render: (_, row) => <div className="log-content"><DetailValue value={logFieldValue(row, 'details.reply')} /></div> },
    { title: label('status', '处理状态'), key: 'status', width: 120, render: (_, row) => <Tag color={row.status === 'error' || row.status === 'failed' ? 'error' : row.status === 'success' || row.status === 'sent' ? 'success' : 'default'}>{row.status ? tr(({ success: '成功', sent: '已发出', received: '已收到', error: '错误', failed: '失败', skipped: '已跳过', rejected: '已拒绝', processing: '处理中', completed: '已完成' } as Record<string, string>)[row.status] ?? row.status) : row.direction === 'in' ? tr('收到') : tr('发出')}</Tag> },
    ...[...fields.values()].filter((field) => !fixedKeys.has(field.key)).map((field) => ({ title: localized(field.label), key: field.key, width: 180, render: (_: unknown, row: ConversationLog) => <div className="log-field-preview"><DetailValue value={logFieldValue(row, field.key)} /></div> })),
  ];
  if (enabled === false) return <section className="logs-disabled"><div className="disabled-icon"><MessageOutlined /></div><div className="eyebrow"><span className="eyebrow-line" /> OBSERVABILITY / DISABLED</div><Title level={2}>{tr('对话日志已关闭')}</Title><Paragraph>{tr('服务端未启用 LOG_RECORD。如需记录对话，请在部署环境启用该配置；现有日志保留策略为 30 天。')}</Paragraph><div className="disabled-meta"><span>LOG_RECORD</span><b>OFF</b><span>RETENTION</span><b>30 DAYS</b></div></section>;
  return <section className="data-page logs-page">
    <div className="log-toolbar"><Form form={form} layout="inline" onFinish={onFilter} className="log-filter-form">
      <Form.Item name="q"><Input allowClear prefix={<MessageOutlined />} placeholder={tr('搜索消息内容或用户 ID')} aria-label={tr('搜索消息内容或用户 ID')} /></Form.Item>
      <Form.Item name="pluginId"><Select allowClear placeholder={tr('全部插件')} aria-label={tr('全部插件')} options={plugins.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
      <Form.Item name="openid"><Input allowClear placeholder={tr('用户或群 openid')} aria-label={tr('用户或群 openid')} /></Form.Item>
      <Form.Item name="from"><Input type="datetime-local" aria-label={tr('开始时间')} /></Form.Item>
      <Form.Item name="to"><Input type="datetime-local" aria-label={tr('结束时间')} /></Form.Item>
      <Form.Item name="accountId"><Select allowClear placeholder={tr('全部账号')} options={accounts.map((item) => ({ label: item.name, value: item.id }))} /></Form.Item>
      <Form.Item name="groupId"><Select allowClear placeholder={tr('全部群聊')} options={groups.map((item) => ({ label: item.name || item.externalId, value: item.id }))} /></Form.Item>
      <Form.Item><Button type="primary" htmlType="submit">{tr('应用筛选')}</Button></Form.Item>
      <Form.Item><Button onClick={() => { form.resetFields(); onFilter({}); }}>{tr('重置')}</Button></Form.Item>
    </Form><div className="log-count"><span className="online-dot" /> {total} RECORDS / 30D</div></div>
    {data.length ? <><Table<ConversationLog> rowKey="id" columns={columns} dataSource={data} pagination={false} scroll={{ x: Math.max(1140, columns.length * 180) }} className="data-table logs-table" expandable={{ expandedRowRender: (row) => <div className="log-details"><h3>{tr('完整消息与插件详情')}</h3><DetailFields values={{ content: row.content, ...Object.fromEntries(Object.entries(row).filter(([key]) => !fixedKeys.has(key))) }} labels={{ content: tr('收到内容'), reply: tr('发送内容'), direction: tr('方向'), accountId: tr('账号'), groupId: tr('群聊'), details: tr('插件详情'), ...Object.fromEntries((rowDefinition(row)?.logFields ?? []).map((field) => [field.key, localized(field.label)])) }} /></div> }} /><div className="logs-pagination"><span>{language === 'en' ? `Page ${page} of ${Math.max(1, Math.ceil(total / 20))}` : `第 ${page} 页 / 共 ${Math.max(1, Math.ceil(total / 20))} 页`}</span><Pagination current={page} pageSize={20} total={total} showSizeChanger={false} onChange={onPage} /></div></> : <EmptyTable title={tr('没有匹配的对话记录')} description={tr('尝试调整筛选条件，或确认服务端日志记录已启用。')} />}
  </section>;
}

function DrawerTitle({ label, title }: { label: string; title: string }) {
  return <div className="drawer-title"><span>{label}</span><strong>{title}</strong></div>;
}

function RoutedApp() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'error'>('checking');
  const [authError, setAuthError] = useState('');
  useEffect(() => {
    const update = () => setRoute(currentRoute());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (route.kind !== 'admin') return;
    let active = true;
    setAuthState('checking');
    setAuthError('');
    api.me().then((result) => {
      if (!active) return;
      if (result.authenticated !== true) {
        setAuthState('error');
        go('/login');
      } else setAuthState('authenticated');
    }).catch((reason) => {
      if (!active) return;
      if (reason instanceof ApiError && reason.status === 401) {
        setAuthState('error');
        go('/login');
      } else {
        setAuthError(formatError(reason));
        setAuthState('error');
      }
    });
    return () => { active = false; };
  }, [route.kind]);
  const loginSuccess = () => { setAuthState('authenticated'); go('/admin/overview'); };
  const logout = () => { setAuthState('checking'); go('/login'); };

  if (route.kind === 'home') return <LandingPage />;
  if (route.kind === 'login') return <LoginPage onSuccess={loginSuccess} />;
  if (route.kind === 'setup') return <SetupPage />;
  if (authState === 'checking') return <div className="auth-check"><Spin /><span>正在验证管理员会话…</span></div>;
  if (authState === 'error') return <main className="auth-error"><BrandMark /><Alert type="error" showIcon message="无法验证管理员会话" description={authError || '请重新登录后再试。'} action={<Button type="primary" href="#/login">前往登录</Button>} /><Button type="link" href="#/">返回首页</Button></main>;
  return <AdminConsole key={route.page} page={route.page} onLogout={logout} />;
}

export default function App() {
  return <LanguageProvider><ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#78cfc3', colorInfo: '#78cfc3', colorSuccess: '#78cfc3', colorBgBase: '#101619', colorBgContainer: '#171f22', colorBgElevated: '#202a2d', colorText: '#e6ecea', colorTextSecondary: '#a1b0ae', colorBorder: '#303d40', borderRadius: 3, fontFamily: '"IBM Plex Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif', controlHeight: 38 } }}><AntApp><RoutedApp /></AntApp></ConfigProvider></LanguageProvider>;
}
