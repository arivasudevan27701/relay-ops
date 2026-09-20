const LIST_KEY = "relay-chats";
const ACTIVE_KEY = "relay-chat-active";

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
};

function isSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function newSessionId(): string {
  return crypto.randomUUID();
}

export function titleFrom(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "New chat";
  return trimmed.length > 42 ? `${trimmed.slice(0, 41)}…` : trimmed;
}

export function chatIdFromUrl(): string | null {
  const id = new URL(window.location.href).searchParams.get("chat");
  return id && isSessionId(id) ? id : null;
}

export function writeChatUrl(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("chat", id);
  history.replaceState(null, "", url);
}

function blank(): ChatSession {
  return { id: newSessionId(), title: "", updatedAt: Date.now() };
}

export function loadSessions(): { sessions: ChatSession[]; activeId: string } {
  let sessions: ChatSession[] = [];
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatSession[];
      if (Array.isArray(parsed)) {
        sessions = parsed.filter((row) => row && isSessionId(row.id));
      }
    }
  } catch {
    sessions = [];
  }

  const fromUrl = chatIdFromUrl();
  const storedActive = localStorage.getItem(ACTIVE_KEY);
  let activeId =
    (fromUrl && sessions.some((row) => row.id === fromUrl) ? fromUrl : null) ||
    (storedActive && sessions.some((row) => row.id === storedActive) ? storedActive : null) ||
    sessions[0]?.id;

  if (fromUrl && !sessions.some((row) => row.id === fromUrl)) {
    sessions = [{ id: fromUrl, title: "", updatedAt: Date.now() }, ...sessions];
    activeId = fromUrl;
  }

  if (!sessions.length || !activeId) {
    const first = blank();
    sessions = [first];
    activeId = first.id;
  }

  writeChatUrl(activeId);
  persistSessions(sessions, activeId);
  return { sessions, activeId };
}

export function persistSessions(sessions: ChatSession[], activeId: string) {
  localStorage.setItem(LIST_KEY, JSON.stringify(sessions));
  localStorage.setItem(ACTIVE_KEY, activeId);
  writeChatUrl(activeId);
}

export function createSession(sessions: ChatSession[]): ChatSession {
  const unused = sessions.find((row) => !row.title);
  if (unused) return unused;
  return blank();
}
