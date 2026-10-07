import { createClient } from '@supabase/supabase-js'

export type Profile = {
  id: string
  email: string
  full_name: string | null
  status: 'pending' | 'approved' | 'revoked'
  role: 'member' | 'admin'
  created_at: string
  last_sign_in_at: string | null
}

export type Product = {
  id: string
  barcode: string
  product_name: string
  brand: string | null
  quantity_label: string | null
  category: string | null
  nutriscore: string | null
  nova_group: number | null
  image_url: string | null
  quantity: number
  quantity_unit: string
  expiration_date: string | null
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
  zone_id: string
  folder_id?: string | null
}

export type Meal = {
  id: string
  name: string
  planned_for: string | null
  notes: string | null
  created_by: string
  created_at: string
  zone_id: string
}

export type CalendarEvent = {
  id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  created_by: string
  created_at: string
  zone_id: string
  color: string
}

export type ShoppingListItem = {
  id: string
  name: string
  is_checked: boolean
  quantity: number
  expiration_date?: string | null
  created_by: string
  created_at: string
  zone_id: string
  image_url?: string | null
  nutriscore?: string | null
  folder_id?: string | null
}

export type StorageFolder = {
  id: string
  name: string
  kind: 'inventory' | 'shopping'
  icon: string
  color: string
  zone_id: string | null
  created_by: string | null
  created_at: string
}

export type Zone = {
  id: string
  name: string
  created_by: string | null
  created_at: string
}

export type ZoneMembership = {
  zone_id: string
  user_id: string
  created_at: string
}

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, Pick<Profile, 'id' | 'email' | 'full_name'> & Partial<Pick<Profile, 'status' | 'role' | 'created_at' | 'last_sign_in_at'>>>
      products: Table<Product, Omit<Product, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<Product, 'id' | 'created_at' | 'updated_at'>>>
      meals: Table<Meal, Omit<Meal, 'id' | 'created_at'> & Partial<Pick<Meal, 'id' | 'created_at'>>>
      calendar_events: Table<CalendarEvent, Omit<CalendarEvent, 'id' | 'created_at'> & Partial<Pick<CalendarEvent, 'id' | 'created_at'>>>
      shopping_list_items: Table<ShoppingListItem, Omit<ShoppingListItem, 'id' | 'created_at' | 'quantity'> & Partial<Pick<ShoppingListItem, 'id' | 'created_at' | 'quantity'>>>
      storage_folders: Table<StorageFolder, Omit<StorageFolder, 'id' | 'created_at'> & Partial<Pick<StorageFolder, 'id' | 'created_at'>>>
      zones: Table<Zone, Pick<Zone, 'name'> & Partial<Pick<Zone, 'id' | 'created_by' | 'created_at'>>>
      zone_members: Table<ZoneMembership, Pick<ZoneMembership, 'zone_id' | 'user_id'> & Partial<Pick<ZoneMembership, 'created_at'>>>
    }
    Views: Record<string, never>
    Functions: {
      consume_product: {
        Args: { p_product_id: string; p_amount: number }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = createClient<Database>(
  supabaseUrl || 'https://not-configured.supabase.co',
  supabaseAnonKey || 'not-configured',
)
