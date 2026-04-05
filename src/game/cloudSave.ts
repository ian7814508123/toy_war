import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadGameState, saveGameState, type SavedGameState } from "./persistence";

type CloudSaveRow = {
  user_id: string;
  slot_id: string;
  version: number;
  saved_at: string;
  save_data: SavedGameState;
};

export interface CloudConfigState {
  enabled: boolean;
  reason: string | null;
}

export interface CloudStatusSnapshot {
  enabled: boolean;
  user: User | null;
  session: Session | null;
  errorMessage?: string;
}

export interface CloudSyncResult {
  ok: boolean;
  message: string;
  reloadedFromCloud: boolean;
}

const SAVE_SLOT_ID = "primary";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

let client: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

const getClient = (): SupabaseClient | null => client;

export const getCloudConfigState = (): CloudConfigState => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      enabled: false,
      reason: "尚未設定 Supabase 環境變數。"
    };
  }

  return {
    enabled: true,
    reason: null
  };
};

export const getCloudStatusSnapshot = async (): Promise<CloudStatusSnapshot> => {
  const supabase = getClient();
  if (!supabase) {
    return { enabled: false, user: null, session: null };
  }

  try {
    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error) {
      return {
        enabled: true,
        session: null,
        user: null,
        errorMessage: error.message
      };
    }

    return {
      enabled: true,
      session: sessionData.session,
      user: sessionData.session?.user ?? null
    };
  } catch (error) {
    return {
      enabled: true,
      session: null,
      user: null,
      errorMessage: error instanceof Error ? error.message : "讀取登入狀態失敗。"
    };
  }
};

export const subscribeCloudAuth = (
  callback: (snapshot: CloudStatusSnapshot) => void | Promise<void>
): (() => void) => {
  const supabase = getClient();
  if (!supabase) {
    return () => undefined;
  }

  const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
    await callback({
      enabled: true,
      session,
      user: session?.user ?? null
    });
  });

  return () => data.subscription.unsubscribe();
};

export const sendMagicLink = async (email: string): Promise<{ ok: boolean; message: string }> => {
  const supabase = getClient();
  if (!supabase) {
    return { ok: false, message: "Supabase 尚未設定。" };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "登入連結已寄出，請到信箱開啟 magic link。" };
};

export const signOutCloud = async (): Promise<{ ok: boolean; message: string }> => {
  const supabase = getClient();
  if (!supabase) {
    return { ok: false, message: "Supabase 尚未設定。" };
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return { ok: false, message: error.message };
  }

  return { ok: true, message: "已登出雲端存檔。" };
};

const getCurrentUserOrError = async (): Promise<{ user: User | null; message?: string }> => {
  const supabase = getClient();
  if (!supabase) {
    return { user: null, message: "Supabase 尚未設定。" };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { user: null, message: "請先登入後再使用雲端存檔。" };
  }

  return { user: data.user };
};

const fetchCloudSave = async (): Promise<CloudSaveRow | null> => {
  const supabase = getClient();
  const userResult = await getCurrentUserOrError();
  if (!supabase || !userResult.user) {
    return null;
  }

  const { data, error } = await supabase
    .from("user_saves")
    .select("user_id, slot_id, version, saved_at, save_data")
    .eq("user_id", userResult.user.id)
    .eq("slot_id", SAVE_SLOT_ID)
    .maybeSingle<CloudSaveRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
};

const uploadSave = async (state: SavedGameState): Promise<void> => {
  const supabase = getClient();
  const userResult = await getCurrentUserOrError();
  if (!supabase || !userResult.user) {
    throw new Error(userResult.message ?? "請先登入後再使用雲端存檔。");
  }

  const payload: CloudSaveRow = {
    user_id: userResult.user.id,
    slot_id: SAVE_SLOT_ID,
    version: state.version,
    saved_at: state.savedAt,
    save_data: state
  };

  const { error } = await supabase.from("user_saves").upsert(payload, {
    onConflict: "user_id,slot_id"
  });

  if (error) {
    throw new Error(error.message);
  }
};

export const syncLocalSaveToCloud = async (): Promise<CloudSyncResult> => {
  try {
    const local = loadGameState();
    if (!local) {
      return {
        ok: false,
        message: "本機目前沒有可同步的存檔。",
        reloadedFromCloud: false
      };
    }

    await uploadSave(local);
    return {
      ok: true,
      message: "本機存檔已同步到雲端。",
      reloadedFromCloud: false
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "同步雲端失敗。",
      reloadedFromCloud: false
    };
  }
};

export const loadCloudSaveToLocal = async (): Promise<CloudSyncResult> => {
  try {
    const cloud = await fetchCloudSave();
    if (!cloud) {
      return {
        ok: false,
        message: "雲端目前沒有存檔。",
        reloadedFromCloud: false
      };
    }

    saveGameState(cloud.save_data);
    return {
      ok: true,
      message: "已把雲端存檔下載到本機，重新整理後會載入新進度。",
      reloadedFromCloud: true
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "下載雲端存檔失敗。",
      reloadedFromCloud: false
    };
  }
};

export const reconcileLocalAndCloudSave = async (): Promise<CloudSyncResult> => {
  try {
    const local = loadGameState();
    const cloud = await fetchCloudSave();

    if (!local && !cloud) {
      return {
        ok: false,
        message: "本機與雲端都還沒有存檔。",
        reloadedFromCloud: false
      };
    }

    if (local && !cloud) {
      await uploadSave(local);
      return {
        ok: true,
        message: "雲端沒有存檔，已把本機進度上傳。",
        reloadedFromCloud: false
      };
    }

    if (!local && cloud) {
      saveGameState(cloud.save_data);
      return {
        ok: true,
        message: "本機沒有存檔，已改用雲端進度。",
        reloadedFromCloud: true
      };
    }

    if (!local || !cloud) {
      return {
        ok: false,
        message: "同步時發生未知狀況。",
        reloadedFromCloud: false
      };
    }

    const localTime = Date.parse(local.savedAt);
    const cloudTime = Date.parse(cloud.save_data.savedAt ?? cloud.saved_at);

    if (Number.isFinite(localTime) && Number.isFinite(cloudTime) && cloudTime > localTime) {
      saveGameState(cloud.save_data);
      return {
        ok: true,
        message: "雲端存檔比較新，已覆蓋本機進度。",
        reloadedFromCloud: true
      };
    }

    await uploadSave(local);
    return {
      ok: true,
      message: "本機存檔比較新，已覆蓋雲端進度。",
      reloadedFromCloud: false
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "同步雲端失敗。",
      reloadedFromCloud: false
    };
  }
};
