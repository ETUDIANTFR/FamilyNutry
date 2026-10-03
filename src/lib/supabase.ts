import { createClient } from '@supabase/supabase-js'

export type Profile = {
  id: string
  email: string
  full_name: string | null
  status: 'pending' | 'approved'
  role: 'member' | 'admin'
  created_at: string
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
}

export type Meal = {
  id: string
  name: string
  planned_for: string | null
  notes: string | null
  created_by: string
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
      profiles: Table<Profile, Pick<Profile, 'id' | 'email' | 'full_name'> & Partial<Pick<Profile, 'status' | 'role' | 'created_at'>>>
      products: Table<Product, Omit<Product, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<Product, 'id' | 'created_at' | 'updated_at'>>>
      meals: Table<Meal, Omit<Meal, 'id' | 'created_at'> & Partial<Pick<Meal, 'id' | 'created_at'>>>
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
