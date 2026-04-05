import { supabase } from './supabaseClient';

export interface GameSaveData {
  resources: { [key: string]: number };
  buildings: any[];
  progress: number;
  // Add other game-specific state here
}

/**
 * Save game data to Supabase
 * @param saveData The data to save
 * @param slotId Optional slot identifier (default: 'primary')
 */
export async function saveGame(saveData: GameSaveData, slotId: string = 'primary') {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User must be logged in to save progress.');
  }

  const { error } = await supabase
    .from('user_saves')
    .upsert({
      user_id: user.id,
      slot_id: slotId,
      save_data: saveData,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error('Error saving game:', error.message);
    throw error;
  }

  console.log('Game saved successfully!');
}

/**
 * Load game data from Supabase
 * @param slotId Optional slot identifier (default: 'primary')
 */
export async function loadGame(slotId: string = 'primary'): Promise<GameSaveData | null> {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    throw new Error('User must be logged in to load progress.');
  }

  const { data, error } = await supabase
    .from('user_saves')
    .select('save_data')
    .eq('user_id', user.id)
    .eq('slot_id', slotId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Record not found is not necessarily an error, just return null
      return null;
    }
    console.error('Error loading game:', error.message);
    throw error;
  }

  return data?.save_data as GameSaveData;
}

/**
 * Quick authentication helper (for teaching purposes)
 * Real apps should use a proper login UI.
 */
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('Error signing in:', error.message);
    throw error;
  }
  return data.user;
}
