import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Html5Qrcode } from 'html5-qrcode'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import type { CalendarEvent, Meal, Product, Profile, ShoppingListItem, Zone, ZoneMembership } from './lib/supabase'
import type { CalendarEventMove } from './SharedCalendar'
import './App.css'

type OffProduct = {
  product_name?: string
  brands?: string
  quantity?: string
  categories?: string
  nutriscore_grade?: string
  nutrition_grades?: string
  nova_group?: number
  image_front_small_url?: string
}

type OffResponse = { status: number; product?: OffProduct }
type Notice = { type: 'success' | 'error' | 'info'; text: string }
type AppTab = 'products' | 'shopping' | 'meals' | 'calendar' | 'members'

function toLocalDateTime(value: Date) {
  const date = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return date.toISOString().slice(0, 16)
}

function addDaysToDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function escapeIcsText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function foldIcsLine(value: string) {
  const encoder = new TextEncoder()
  let output = ''
  let line = ''
  let lineBytes = 0
  for (const character of value) {
    const characterBytes = encoder.encode(character).length
    if (lineBytes + characterBytes > 75) {
      output += `${line}\r\n `
      line = ''
      lineBytes = 1
    }
    line += character
    lineBytes += characterBytes
  }
  return output + line
}

function icsDateTime(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

const gradeLabels: Record<string, string> = {
  a: 'Excellent',
  b: 'Très bien',
  c: 'Bien',
  d: 'Médiocre',
  e: 'À limiter',
}

const SharedCalendar = lazy(() => import('./SharedCalendar'))

function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('nutriscan-theme') === 'dark')
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [shoppingItems, setShoppingItems] = useState<ShoppingListItem[]>([])
  const [shoppingItemName, setShoppingItemName] = useState('')
  const [addingShoppingItem, setAddingShoppingItem] = useState(false)
  const [meals, setMeals] = useState<Meal[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [zoneMemberships, setZoneMemberships] = useState<ZoneMembership[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [writeZoneId, setWriteZoneId] = useState('')
  const [newZoneName, setNewZoneName] = useState('')
  const [zoneNameEdits, setZoneNameEdits] = useState<Record<string, string>>({})
  const [savingZone, setSavingZone] = useState(false)
  const [pendingUsers, setPendingUsers] = useState<Profile[]>([])
  const [memberUsers, setMemberUsers] = useState<Profile[]>([])
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [barcode, setBarcode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [foundProduct, setFoundProduct] = useState<{ barcode: string; data: OffProduct } | null>(null)
  const [savingProduct, setSavingProduct] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>('products')
  const [selectedProducts, setSelectedProducts] = useState<Record<string, number>>({})
  const [manualName, setManualName] = useState('')
  const [manualAmount, setManualAmount] = useState('1')
  const [manualUnit, setManualUnit] = useState('unité')
  const [expirationDate, setExpirationDate] = useState('')
  const [newAmount, setNewAmount] = useState('1')
  const [newUnit, setNewUnit] = useState('unité')
  const [manualOpen, setManualOpen] = useState(false)
  const [mealName, setMealName] = useState('')
  const [mealDate, setMealDate] = useState('')
  const [mealNotes, setMealNotes] = useState('')
  const [savingMeal, setSavingMeal] = useState(false)
  const calendarFileInput = useRef<HTMLInputElement>(null)
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [calendarEventTitle, setCalendarEventTitle] = useState('')
  const [calendarEventDescription, setCalendarEventDescription] = useState('')
  const [calendarEventColor, setCalendarEventColor] = useState('#4F7548')
  const [calendarEventStart, setCalendarEventStart] = useState('')
  const [calendarEventEnd, setCalendarEventEnd] = useState('')
  const [calendarEventAllDay, setCalendarEventAllDay] = useState(false)
  const [savingCalendarEvent, setSavingCalendarEvent] = useState(false)
  const [importingCalendar, setImportingCalendar] = useState(false)
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
    localStorage.setItem('nutriscan-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  const activeZoneId = selectedZoneId && zones.some((zone) => zone.id === selectedZoneId) ? selectedZoneId : null
  const effectiveWriteZoneId = zones.some((zone) => zone.id === writeZoneId) ? writeZoneId : zones[0]?.id ?? ''
  const creationZoneId = activeZoneId ?? effectiveWriteZoneId
  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase.from('products').select('*').order('updated_at', { ascending: false })
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger les produits : ${error.message}` })
      return
    }
    setProducts(data ?? [])
  }, [])

  const loadMeals = useCallback(async () => {
    const { data, error } = await supabase.from('meals').select('*').order('planned_for', { ascending: true, nullsFirst: false })
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger les repas : ${error.message}` })
      return
    }
    setMeals(data ?? [])
  }, [])

  const loadCalendarEvents = useCallback(async () => {
    const { data, error } = await supabase.from('calendar_events').select('*').order('starts_at')
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger le calendrier : ${error.message}` })
      return false
    }
    setCalendarEvents(data ?? [])
    return true
  }, [])

  const loadZones = useCallback(async () => {
    const { data, error } = await supabase.from('zones').select('*').order('name')
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger les groupes : ${error.message}` })
      return
    }
    setZones(data ?? [])
  }, [])

  const loadZoneMemberships = useCallback(async () => {
    const { data, error } = await supabase.from('zone_members').select('*')
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger les groupes des membres : ${error.message}` })
      return
    }
    setZoneMemberships(data ?? [])
  }, [])

  const loadShoppingItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('shopping_list_items')
      .select('*')
      .order('is_checked')
      .order('created_at')
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger la liste de courses : ${error.message}` })
      return
    }
    setShoppingItems(data ?? [])
  }, [])

  const loadPendingUsers = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('status', 'pending').order('created_at')
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger les demandes : ${error.message}` })
      return
    }
    setPendingUsers(data ?? [])
  }, [])

  const loadMemberUsers = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .in('status', ['approved', 'revoked'])
      .order('created_at')
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger les membres : ${error.message}` })
      return
    }
    setMemberUsers(data ?? [])
  }, [])

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger le profil : ${error.message}` })
      return
    }
    setProfile(data)
    if (data?.status === 'approved') {
      void loadProducts()
      void loadShoppingItems()
      void loadMeals()
      void loadCalendarEvents()
      void loadZones()
      if (data.role === 'admin') {
        void loadPendingUsers()
        void loadMemberUsers()
        void loadZoneMemberships()
      }
    }
  }, [loadProducts, loadShoppingItems, loadMeals, loadCalendarEvents, loadZones, loadPendingUsers, loadMemberUsers, loadZoneMemberships])

  useEffect(() => {
    let active = true
    const initialise = async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) setNotice({ type: 'error', text: error.message })
      if (!active) return
      const user = data.session?.user
      setSessionUser(user ? { id: user.id, email: user.email } : null)
      if (!user) {
        setLoading(false)
        return
      }
      const { data: profileData, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (!active) return
      if (profileError) setNotice({ type: 'error', text: `Impossible de charger le profil : ${profileError.message}` })
      setProfile(profileData)
      if (profileData?.status === 'approved') {
        const { data: productData, error: productsError } = await supabase.from('products').select('*').order('updated_at', { ascending: false })
        if (productsError) setNotice({ type: 'error', text: `Impossible de charger les produits : ${productsError.message}` })
        if (active) setProducts(productData ?? [])
        const { data: shoppingData, error: shoppingError } = await supabase
          .from('shopping_list_items')
          .select('*')
          .order('is_checked')
          .order('created_at')
        if (shoppingError) setNotice({ type: 'error', text: `Impossible de charger la liste de courses : ${shoppingError.message}` })
        if (active) setShoppingItems(shoppingData ?? [])
        const { data: calendarData, error: calendarError } = await supabase
          .from('calendar_events')
          .select('*')
          .order('starts_at')
        if (calendarError) setNotice({ type: 'error', text: `Impossible de charger le calendrier : ${calendarError.message}` })
        if (active) setCalendarEvents(calendarData ?? [])
        if (profileData.role === 'admin') {
          const { data: pendingData, error: pendingError } = await supabase.from('profiles').select('*').eq('status', 'pending').order('created_at')
          if (pendingError) setNotice({ type: 'error', text: `Impossible de charger les demandes : ${pendingError.message}` })
          if (active) setPendingUsers(pendingData ?? [])
          const { data: memberData, error: membersError } = await supabase
            .from('profiles')
            .select('*')
            .in('status', ['approved', 'revoked'])
            .order('created_at')
          if (membersError) setNotice({ type: 'error', text: `Impossible de charger les membres : ${membersError.message}` })
          if (active) setMemberUsers(memberData ?? [])
          const { data: membershipData, error: membershipError } = await supabase.from('zone_members').select('*')
          if (membershipError) setNotice({ type: 'error', text: `Impossible de charger les groupes des membres : ${membershipError.message}` })
          if (active) setZoneMemberships(membershipData ?? [])
        }
        const { data: zoneData, error: zonesError } = await supabase.from('zones').select('*').order('name')
        if (zonesError) setNotice({ type: 'error', text: `Impossible de charger les groupes : ${zonesError.message}` })
        if (active) setZones(zoneData ?? [])
        const { data: mealData, error: mealsError } = await supabase.from('meals').select('*').order('planned_for', { ascending: true, nullsFirst: false })
        if (mealsError) setNotice({ type: 'error', text: `Impossible de charger les repas : ${mealsError.message}` })
        if (active) setMeals(mealData ?? [])
      }
      if (active) setLoading(false)
    }
    void initialise()
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user
      setSessionUser(user ? { id: user.id, email: user.email } : null)
      if (!user) {
        setProfile(null)
        setProducts([])
        setShoppingItems([])
        setMeals([])
        setCalendarEvents([])
        setZones([])
        setZoneMemberships([])
        setSelectedZoneId(null)
        setWriteZoneId('')
        setPendingUsers([])
        setMemberUsers([])
        setLoading(false)
      } else {
        setLoading(true)
        window.setTimeout(() => {
          if (active) {
            void loadProfile(user.id)
            setLoading(false)
          }
        }, 0)
      }
    })
    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [loadProfile])

  useEffect(() => {
    if (!profile || profile.status !== 'approved') return
    const channel = supabase
      .channel('shared-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => void loadProducts())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_list_items' }, () => void loadShoppingItems())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => void loadMeals())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => void loadCalendarEvents())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zones' }, () => void loadZones())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zone_members' }, () => {
        void loadZones()
        if (profile.role === 'admin') void loadZoneMemberships()
        else {
          void loadProducts()
          void loadShoppingItems()
          void loadMeals()
          void loadCalendarEvents()
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        if (profile.role === 'admin') {
          void loadPendingUsers()
          void loadMemberUsers()
        }
        if (sessionUser) void loadProfile(sessionUser.id)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadProducts, loadShoppingItems, loadMeals, loadCalendarEvents, loadZones, loadZoneMemberships, loadPendingUsers, loadMemberUsers, loadProfile, profile, sessionUser])

  const lookupBarcode = useCallback(async (value: string) => {
    const code = value.trim().replace(/\s/g, '')
    if (!code) return
    setLookupBusy(true)
    setFoundProduct(null)
    setNotice(null)
    try {
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,quantity,categories,nutriscore_grade,nutrition_grades,nova_group,image_front_small_url`,
      )
      if (!response.ok) throw new Error(`Open Food Facts a répondu ${response.status}.`)
      const result = (await response.json()) as OffResponse
      if (result.status !== 1 || !result.product) {
        throw new Error('Produit introuvable dans Open Food Facts. Vérifiez le code ou saisissez un autre produit.')
      }
      setFoundProduct({ barcode: code, data: result.product })
      const pack = parsePack(result.product.quantity)
      setNewAmount(String(pack.amount))
      setNewUnit(pack.unit)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'La recherche du produit a échoué.' })
    } finally {
      setLookupBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!scannerOpen) return
    let mounted = true
    let reader: Html5Qrcode | null = null
    void import('html5-qrcode').then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
      if (!mounted) return
      reader = new Html5Qrcode('qr-reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        verbose: false,
      })
      return reader.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
          if (!mounted) return
          setBarcode(decodedText)
          if (reader?.isScanning) void reader.stop().catch(() => undefined)
          setScanning(false)
          void lookupBarcode(decodedText)
        },
        () => undefined,
      ).then(() => {
        if (mounted) setScanning(true)
      })
    }).catch((error: unknown) => {
      if (mounted) {
        setScanning(false)
        setNotice({ type: 'error', text: `La caméra n’a pas pu démarrer : ${String(error)}` })
      }
    })
    return () => {
      mounted = false
      if (reader?.isScanning) void reader.stop().catch(() => undefined)
    }
  }, [scannerOpen, lookupBarcode])

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setNotice(null)
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim() } },
        })
        if (error) throw error
        if (data.session) {
          setSessionUser({ id: data.session.user.id, email: data.session.user.email })
          await loadProfile(data.session.user.id)
        } else {
          setNotice({ type: 'success', text: 'Compte créé. Confirmez votre email, puis attendez l’accord de l’administrateur.' })
          setAuthMode('login')
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setSessionUser({ id: data.user.id, email: data.user.email })
        await loadProfile(data.user.id)
      }
    } catch (error) {
      setNotice({ type: 'error', text: authMessage(error) })
    } finally {
      setAuthBusy(false)
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) setNotice({ type: 'error', text: `Déconnexion impossible : ${error.message}` })
  }

  async function approveUser(user: Profile) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ status: 'approved' })
      .eq('id', user.id)
      .select('id')
      .maybeSingle()
    if (error) {
      setNotice({ type: 'error', text: `Approbation impossible : ${error.message}` })
      return
    }
    if (!data) {
      setNotice({ type: 'error', text: 'Approbation impossible : aucun profil correspondant n’a été mis à jour.' })
      return
    }
    setNotice({ type: 'success', text: `${user.full_name || user.email} peut maintenant accéder à la liste.` })
    await Promise.all([loadPendingUsers(), loadMemberUsers(), loadZones(), loadZoneMemberships()])
  }

  async function revokeUser(user: Profile) {
    if (user.role !== 'member' || user.id === sessionUser?.id) return
    setRevokingUserId(user.id)
    const { data, error } = await supabase
      .from('profiles')
      .update({ status: 'revoked' })
      .eq('id', user.id)
      .eq('role', 'member')
      .eq('status', 'approved')
      .select('id')
      .maybeSingle()
    if (error) {
      setNotice({ type: 'error', text: `Révocation impossible : ${error.message}` })
    } else if (!data) {
      setNotice({ type: 'error', text: 'Révocation impossible : aucun profil correspondant n’a été révoqué.' })
    } else {
      setNotice({ type: 'success', text: `L’accès de ${user.full_name || user.email} a été révoqué.` })
      await Promise.all([loadPendingUsers(), loadMemberUsers()])
    }
    setRevokingUserId(null)
  }

  async function createZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newZoneName.trim()
    if (!name) return
    setSavingZone(true)
    const { error } = await supabase.from('zones').insert({ name, created_by: sessionUser?.id ?? null })
    if (error) {
      setNotice({ type: 'error', text: `Création du groupe impossible : ${error.message}` })
    } else {
      setNewZoneName('')
      setNotice({ type: 'success', text: `Le groupe « ${name} » a été créé.` })
      await loadZones()
    }
    setSavingZone(false)
  }

  async function renameZone(zone: Zone) {
    const name = (zoneNameEdits[zone.id] ?? zone.name).trim()
    if (!name || name === zone.name) return
    const { error } = await supabase.from('zones').update({ name }).eq('id', zone.id)
    if (error) {
      setNotice({ type: 'error', text: `Modification du groupe impossible : ${error.message}` })
      return
    }
    setNotice({ type: 'success', text: `Le groupe a été renommé « ${name} ».` })
    await loadZones()
  }

  async function changeZoneMembership(user: Profile, zone: Zone, isMember: boolean) {
    const result = isMember
      ? await supabase.from('zone_members').insert({ zone_id: zone.id, user_id: user.id })
      : await supabase.from('zone_members').delete().eq('zone_id', zone.id).eq('user_id', user.id)
    if (result.error) {
      setNotice({ type: 'error', text: `Modification des groupes de ${user.full_name || user.email} impossible : ${result.error.message}` })
      return
    }
    await loadZoneMemberships()
  }

  async function addShoppingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionUser || !creationZoneId) return
    const name = shoppingItemName.trim()
    if (!name) return
    setAddingShoppingItem(true)
    const { error } = await supabase.from('shopping_list_items').insert({
      name,
      is_checked: false,
      created_by: sessionUser.id,
      zone_id: creationZoneId,
    })
    if (error) {
      setNotice({ type: 'error', text: `Ajout à la liste de courses impossible : ${error.message}` })
    } else {
      setShoppingItemName('')
      setNotice({ type: 'success', text: `${name} a été ajouté à la liste de courses.` })
      await loadShoppingItems()
    }
    setAddingShoppingItem(false)
  }

  async function toggleShoppingItem(item: ShoppingListItem) {
    const isChecked = !item.is_checked
    setShoppingItems((items) => items.map((current) => current.id === item.id
      ? { ...current, is_checked: isChecked }
      : current))
    const { error } = await supabase
      .from('shopping_list_items')
      .update({ is_checked: isChecked })
      .eq('id', item.id)
    if (error) {
      setNotice({ type: 'error', text: `Mise à jour de « ${item.name} » impossible : ${error.message}` })
      await loadShoppingItems()
      return
    }
    await loadShoppingItems()
  }

  async function deleteShoppingItem(item: ShoppingListItem) {
    const { error } = await supabase.from('shopping_list_items').delete().eq('id', item.id)
    if (error) {
      setNotice({ type: 'error', text: `Suppression de « ${item.name} » impossible : ${error.message}` })
      return
    }
    setNotice({ type: 'info', text: `${item.name} a été supprimé de la liste.` })
    await loadShoppingItems()
  }

  async function clearCheckedShoppingItems() {
    let query = supabase.from('shopping_list_items').delete().eq('is_checked', true)
    if (activeZoneId) query = query.eq('zone_id', activeZoneId)
    const { error } = await query
    if (error) {
      setNotice({ type: 'error', text: `Impossible de supprimer les articles cochés : ${error.message}` })
      return
    }
    setNotice({ type: 'info', text: 'Les articles cochés ont été supprimés de la liste.' })
    await loadShoppingItems()
  }

  async function lookupProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await lookupBarcode(barcode)
  }

  async function saveProduct() {
    if (!foundProduct || !sessionUser || !creationZoneId) return
    setSavingProduct(true)
    setNotice(null)
    const grade = (foundProduct.data.nutriscore_grade || foundProduct.data.nutrition_grades || '').toLowerCase()
    const { data: existing, error: findError } = await supabase.from('products').select('id, quantity, quantity_unit, expiration_date').eq('zone_id', creationZoneId).eq('barcode', foundProduct.barcode).maybeSingle()
    if (findError) {
      setNotice({ type: 'error', text: `Vérification du produit impossible : ${findError.message}` })
      setSavingProduct(false)
      return
    }
    const amount = Number(newAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: 'error', text: 'La quantité doit être supérieure à zéro.' })
      setSavingProduct(false)
      return
    }
    const productValues = {
      barcode: foundProduct.barcode,
      product_name: foundProduct.data.product_name?.trim() || 'Produit sans nom',
      brand: foundProduct.data.brands?.trim() || null,
      quantity_label: foundProduct.data.quantity?.trim() || null,
      category: foundProduct.data.categories?.split(',')[0]?.trim() || null,
      nutriscore: /^[a-e]$/.test(grade) ? grade : null,
      nova_group: foundProduct.data.nova_group && foundProduct.data.nova_group >= 1 && foundProduct.data.nova_group <= 4
        ? foundProduct.data.nova_group
        : null,
      image_url: foundProduct.data.image_front_small_url || null,
      quantity: Number(newAmount),
      quantity_unit: newUnit,
      expiration_date: expirationDate || existing?.expiration_date || null,
      updated_by: sessionUser.id,
      zone_id: creationZoneId,
    }
    const saveResult = existing
      ? await supabase.from('products').update({
        ...productValues,
        quantity: existing.quantity + (existing.quantity_unit === newUnit ? amount : 1),
        quantity_unit: existing.quantity_unit || newUnit,
      }).eq('id', existing.id)
      : await supabase.from('products').insert({ ...productValues, created_by: sessionUser.id })
    if (saveResult.error) {
      setNotice({ type: 'error', text: `Enregistrement impossible : ${saveResult.error.message}` })
    } else {
      setNotice({ type: 'success', text: `${productValues.product_name} a été ajouté à la liste partagée.` })
      setFoundProduct(null)
      setBarcode('')
      setExpirationDate('')
      await loadProducts()
    }
    setSavingProduct(false)
  }

  async function changeQuantity(product: Product, delta: number) {
    const pack = parsePack(product.quantity_label)
    const step = pack.unit === product.quantity_unit ? pack.amount : 1
    const next = Number((product.quantity + delta * step).toFixed(3))
    if (next <= 0) {
      const { error } = await supabase.from('products').delete().eq('id', product.id)
      if (error) setNotice({ type: 'error', text: `Suppression impossible : ${error.message}` })
      else setNotice({ type: 'info', text: `${product.product_name} a été retiré de la liste.` })
    } else {
      const { error } = await supabase.from('products').update({ quantity: next, updated_by: sessionUser?.id }).eq('id', product.id)
      if (error) setNotice({ type: 'error', text: `Mise à jour impossible : ${error.message}` })
    }
    await loadProducts()
  }

  async function saveManualProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionUser || !creationZoneId) return
    const amount = Number(manualAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice({ type: 'error', text: 'La quantité doit être supérieure à zéro.' })
      return
    }
    setSavingProduct(true)
    const name = manualName.trim()
    if (!name) {
      setNotice({ type: 'error', text: 'Saisissez le nom du produit.' })
      setSavingProduct(false)
      return
    }
    const { error } = await supabase.from('products').insert({
      barcode: `MANUAL-${crypto.randomUUID()}`,
      product_name: name,
      brand: null,
      quantity_label: null,
      category: null,
      nutriscore: null,
      nova_group: null,
      image_url: null,
      quantity: amount,
      quantity_unit: manualUnit,
      expiration_date: expirationDate || null,
      created_by: sessionUser.id,
      updated_by: sessionUser.id,
      zone_id: creationZoneId,
    })
    if (error) {
      setNotice({ type: 'error', text: `Ajout impossible : ${error.message}` })
    } else {
      setNotice({ type: 'success', text: `${name} a été ajouté à la liste partagée.` })
      setManualName('')
      setManualAmount('1')
      setManualUnit('unité')
      setExpirationDate('')
      setManualOpen(false)
      await loadProducts()
    }
    setSavingProduct(false)
  }

  async function consumeSelected() {
    if (!sessionUser) return
    const selected = visibleProducts.filter((product) => selectedProducts[product.id] !== undefined)
    if (selected.length === 0) return
    const failures: string[] = []
    for (const product of selected) {
      const amount = selectedProducts[product.id]
      if (!Number.isFinite(amount) || amount <= 0 || amount > product.quantity) {
        failures.push(`${product.product_name} : quantité invalide`)
        continue
      }
      const { error } = await supabase.rpc('consume_product', { p_product_id: product.id, p_amount: amount })
      if (error) failures.push(`${product.product_name} : ${error.message}`)
    }
    setSelectedProducts({})
    await loadProducts()
    setNotice(failures.length
      ? { type: 'error', text: `Certaines consommations ont échoué : ${failures.slice(0, 2).join(' ; ')}${failures.length > 2 ? ` ; et ${failures.length - 2} autre(s)` : ''}.` }
      : { type: 'success', text: `Consommation enregistrée pour ${selected.length} produit(s).` })
  }

  async function copyProducts() {
    const text = groupProducts.map((product) =>
      `- ${product.product_name} : ${product.quantity} ${product.quantity_unit}${product.expiration_date ? ` (péremption : ${product.expiration_date})` : ''}${product.nutriscore ? ` — Nutri-Score ${product.nutriscore.toUpperCase()}` : ''}`,
    ).join('\n')
    try {
      await navigator.clipboard.writeText(text || 'La liste de courses est vide.')
      setNotice({ type: 'success', text: 'La liste complète a été copiée dans le presse-papiers.' })
    } catch (error) {
      setNotice({ type: 'error', text: `Copie impossible : ${error instanceof Error ? error.message : 'accès au presse-papiers refusé.'}` })
    }
  }

  async function addMeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionUser || !creationZoneId) return
    setSavingMeal(true)
    const { error } = await supabase.from('meals').insert({
      name: mealName.trim(),
      planned_for: mealDate || null,
      notes: mealNotes.trim() || null,
      created_by: sessionUser.id,
      zone_id: creationZoneId,
    })
    if (error) {
      setNotice({ type: 'error', text: `Ajout du repas impossible : ${error.message}` })
    } else {
      setMealName('')
      setMealDate('')
      setMealNotes('')
      setNotice({ type: 'success', text: 'Le repas a été ajouté au planning partagé.' })
      await loadMeals()
    }
    setSavingMeal(false)
  }

  async function deleteMeal(meal: Meal) {
    const { error } = await supabase.from('meals').delete().eq('id', meal.id)
    if (error) setNotice({ type: 'error', text: `Suppression du repas impossible : ${error.message}` })
    else {
      setNotice({ type: 'info', text: `${meal.name} a été retiré du planning.` })
      await loadMeals()
    }
  }

  function openCalendarEvent(date?: Date, allDay = false) {
    const start = date ?? new Date()
    const startValue = toLocalDateTime(start)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    setEditingEventId(null)
    setCalendarEventTitle('')
    setCalendarEventDescription('')
    setCalendarEventColor('#4F7548')
    setCalendarEventStart(startValue)
    setCalendarEventEnd(toLocalDateTime(end))
    setCalendarEventAllDay(allDay)
    setEventModalOpen(true)
  }

  function editCalendarEvent(event: CalendarEvent) {
    const start = new Date(event.starts_at)
    const end = new Date(event.ends_at)
    setEditingEventId(event.id)
    setCalendarEventTitle(event.title)
    setCalendarEventDescription(event.description ?? '')
    setCalendarEventColor(event.color)
    setCalendarEventStart(event.all_day ? `${event.starts_at.slice(0, 10)}T09:00` : toLocalDateTime(start))
    setCalendarEventEnd(event.all_day
      ? `${addDaysToDate(event.ends_at.slice(0, 10), -1)}T10:00`
      : toLocalDateTime(end))
    setCalendarEventAllDay(event.all_day)
    setEventModalOpen(true)
  }

  async function saveCalendarEvent(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    if (!sessionUser || (!editingEventId && !creationZoneId)) return
    const startValue = calendarEventStart.slice(0, 16)
    const endValue = calendarEventEnd.slice(0, 16)
    const startDate = new Date(startValue)
    const endDate = new Date(endValue)
    if (!calendarEventTitle.trim() || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setNotice({ type: 'error', text: 'Vérifiez le titre et les dates de l’événement.' })
      return
    }

    let startsAt: string
    let endsAt: string
    if (calendarEventAllDay) {
      const firstDay = startValue.slice(0, 10)
      const lastDay = endValue.slice(0, 10)
      if (lastDay < firstDay) {
        setNotice({ type: 'error', text: 'La date de fin doit être égale ou postérieure à la date de début.' })
        return
      }
      startsAt = `${firstDay}T00:00:00.000Z`
      endsAt = `${addDaysToDate(lastDay, 1)}T00:00:00.000Z`
    } else {
      if (endDate <= startDate) {
        setNotice({ type: 'error', text: 'L’heure de fin doit être postérieure à l’heure de début.' })
        return
      }
      startsAt = startDate.toISOString()
      endsAt = endDate.toISOString()
    }

    setSavingCalendarEvent(true)
    const values = {
      title: calendarEventTitle.trim(),
      description: calendarEventDescription.trim() || null,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: calendarEventAllDay,
      color: calendarEventColor,
    }
    const result = editingEventId
      ? await supabase.from('calendar_events').update(values).eq('id', editingEventId)
      : await supabase.from('calendar_events').insert({ ...values, created_by: sessionUser.id, zone_id: creationZoneId })
    if (result.error) {
      setNotice({ type: 'error', text: `Enregistrement de l’événement impossible : ${result.error.message}` })
    } else {
      setEventModalOpen(false)
      if (await loadCalendarEvents()) {
        setNotice({ type: 'success', text: editingEventId ? 'Événement modifié.' : 'Événement ajouté au calendrier.' })
      }
    }
    setSavingCalendarEvent(false)
  }

  async function deleteCalendarEvent() {
    if (!editingEventId) return
    const { error } = await supabase.from('calendar_events').delete().eq('id', editingEventId)
    if (error) {
      setNotice({ type: 'error', text: `Suppression de l’événement impossible : ${error.message}` })
    } else {
      setEventModalOpen(false)
      if (await loadCalendarEvents()) setNotice({ type: 'info', text: 'Événement supprimé du calendrier.' })
    }
  }

  async function moveCalendarEvent(event: CalendarEventMove, revert: () => void) {
    if (!event.start) {
      revert()
      return
    }
    const startsAt = event.allDay
      ? `${toLocalDateTime(event.start).slice(0, 10)}T00:00:00.000Z`
      : event.start.toISOString()
    const endDate = event.end ?? new Date(event.start.getTime() + (event.allDay ? 86_400_000 : 3_600_000))
    const endsAt = event.allDay
      ? `${toLocalDateTime(endDate).slice(0, 10)}T00:00:00.000Z`
      : endDate.toISOString()
    const { error } = await supabase.from('calendar_events').update({
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: event.allDay,
    }).eq('id', event.id)
    if (error) {
      revert()
      setNotice({ type: 'error', text: `Déplacement de l’événement impossible : ${error.message}` })
      return
    }
    await loadCalendarEvents()
  }

  function exportCalendar() {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NutriScan//Calendrier//FR',
      'CALSCALE:GREGORIAN',
      ...groupCalendarEvents.flatMap((event) => [
        'BEGIN:VEVENT',
        `UID:${event.id}@nutriscan`,
        `DTSTAMP:${icsDateTime(event.created_at)}`,
        event.all_day
          ? `DTSTART;VALUE=DATE:${event.starts_at.slice(0, 10).replace(/-/g, '')}`
          : `DTSTART:${icsDateTime(event.starts_at)}`,
        event.all_day
          ? `DTEND;VALUE=DATE:${event.ends_at.slice(0, 10).replace(/-/g, '')}`
          : `DTEND:${icsDateTime(event.ends_at)}`,
        `SUMMARY:${escapeIcsText(event.title)}`,
        `COLOR:${event.color}`,
        ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ]
    const content = `${lines.map(foldIcsLine).join('\r\n')}\r\n`
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'nutriscan-calendrier.ics'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice({ type: 'success', text: `${groupCalendarEvents.length} événement(s) exporté(s) au format iCalendar.` })
  }

  async function importCalendarFile(formEvent: ChangeEvent<HTMLInputElement>) {
    const file = formEvent.currentTarget.files?.[0]
    formEvent.currentTarget.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setNotice({ type: 'error', text: 'Le fichier .ics dépasse la taille maximale de 10 Mo.' })
      return
    }
    if (!sessionUser || !creationZoneId) return

    setImportingCalendar(true)
    try {
      const { default: ICAL } = await import('ical.js')
      const parsed = ICAL.parse(await file.text())
      const calendar = new ICAL.Component(parsed)
      const components = calendar.getAllSubcomponents('vevent')
      if (components.length > 500) throw new Error('Le fichier contient plus de 500 événements.')
      let skippedRecurring = 0
      const imported: Array<Omit<CalendarEvent, 'id' | 'created_at'>> = []
      for (const component of components) {
        if (component.getFirstProperty('rrule') || component.getFirstProperty('recurrence-id')) {
          skippedRecurring += 1
          continue
        }
        const event = new ICAL.Event(component)
        const start = event.startDate
        if (!start) continue
        const allDay = start.isDate
        const defaultEnd = start.clone()
        defaultEnd.addDuration(ICAL.Duration.fromSeconds(allDay ? 86_400 : 3_600))
        const hasExplicitEnd = component.getFirstProperty('dtend') || component.getFirstProperty('duration')
        const end = hasExplicitEnd ? event.endDate : defaultEnd
        const toStoredDate = (value: typeof start) => value.isDate
          ? `${value.toString()}T00:00:00.000Z`
          : value.toJSDate().toISOString()
        const startsAt = toStoredDate(start)
        const endsAt = toStoredDate(end)
        if (new Date(endsAt) <= new Date(startsAt)) continue
        imported.push({
          title: event.summary?.trim() || 'Événement sans titre',
          description: event.description?.trim() || null,
          starts_at: startsAt,
          ends_at: endsAt,
          all_day: allDay,
          color: '#4F7548',
          zone_id: creationZoneId,
          created_by: sessionUser.id,
        })
      }
      if (imported.length === 0) {
        setNotice({
          type: skippedRecurring ? 'info' : 'error',
          text: skippedRecurring
            ? `Aucun événement importable : ${skippedRecurring} événement(s) récurrent(s) ne sont pas pris en charge.`
            : 'Aucun événement valide trouvé dans ce fichier .ics.',
        })
      } else {
        const { error } = await supabase.from('calendar_events').insert(imported)
        if (error) throw new Error(error.message)
        if (!await loadCalendarEvents()) return
        setNotice({
          type: skippedRecurring ? 'info' : 'success',
          text: `${imported.length} événement(s) importé(s)${skippedRecurring ? ` ; ${skippedRecurring} récurrent(s) ignoré(s)` : ''}.`,
        })
      }
    } catch (error) {
      setNotice({
        type: 'error',
        text: `Import iCalendar impossible : ${error instanceof Error ? error.message : 'fichier invalide.'}`,
      })
    } finally {
      setImportingCalendar(false)
    }
  }

  function openScanner() {
    setNotice(null)
    setScannerOpen(true)
  }

  const inSelectedZone = <T extends { zone_id: string }>(items: T[]) =>
    activeZoneId ? items.filter((item) => item.zone_id === activeZoneId) : items
  const groupProducts = inSelectedZone(products)
  const groupShoppingItems = inSelectedZone(shoppingItems)
  const groupMeals = inSelectedZone(meals)
  const groupCalendarEvents = inSelectedZone(calendarEvents)
  const showGroupNames = activeZoneId === null && zones.length > 1
  const getZoneName = (zoneId: string) => zones.find((zone) => zone.id === zoneId)?.name ?? 'Groupe'
  const visibleProducts = groupProducts.filter((product) => {
    const query = search.trim().toLocaleLowerCase('fr')
    return !query || `${product.product_name} ${product.brand ?? ''} ${product.category ?? ''} ${product.barcode}`.toLocaleLowerCase('fr').includes(query)
  })
  const gradedProducts = groupProducts.filter((product) => product.nutriscore)
  const healthyProducts = gradedProducts.filter((product) => product.nutriscore === 'a' || product.nutriscore === 'b').length

  if (!isSupabaseConfigured) {
    return <SetupScreen />
  }

  if (loading) {
    return <main className="loading-screen"><span className="brand-mark">n</span><p>Préparation de votre espace partagé…</p></main>
  }

  if (!sessionUser) {
    return (
      <main className="auth-page">
        <div className="auth-art">
          <div className="auth-art-content">
            <span className="eyebrow">LE BON CHOIX, EN ÉQUIPE</span>
            <h1>Votre liste.<br />Vos bons choix.</h1>
            <p>Scannez, découvrez et partagez les informations nutritionnelles de vos produits.</p>
            <div className="auth-visual">
              <div className="fruit fruit-orange">◉</div><div className="fruit fruit-green">◉</div><div className="fruit fruit-leaf">✳</div>
              <span className="visual-label">Mieux manger, ensemble.</span>
            </div>
            <span className="auth-foot">Les données nutritionnelles sont fournies par Open Food Facts.</span>
          </div>
        </div>
        <section className="auth-panel">
          <div className="auth-card">
            <Brand />
            <span className="eyebrow auth-eyebrow">{authMode === 'login' ? 'HEUREUX DE VOUS REVOIR' : 'REJOIGNEZ VOTRE GROUPE'}</span>
            <h2>{authMode === 'login' ? 'Connexion' : 'Créer un compte'}</h2>
            <p className="auth-description">{authMode === 'login' ? 'Connectez-vous pour retrouver votre liste commune.' : 'Un administrateur approuvera votre demande. 10 comptes maximum.'}</p>
            <NoticeView notice={notice} />
            <form className="auth-form" onSubmit={handleAuth}>
              {authMode === 'signup' && <label>Votre nom<input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Ex. Camille Martin" required maxLength={80} /></label>}
              <label>Adresse email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vous@exemple.fr" required /></label>
              <label>Mot de passe<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8 caractères minimum" minLength={8} required /></label>
              <button className="button button-primary button-wide" disabled={authBusy}>{authBusy ? 'Veuillez patienter…' : authMode === 'login' ? 'Se connecter' : 'Demander un accès'}<span>↗</span></button>
            </form>
            <p className="auth-switch">{authMode === 'login' ? 'Nouveau dans le groupe ?' : 'Vous avez déjà un compte ?'} <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setNotice(null) }}>{authMode === 'login' ? 'Créer un compte' : 'Se connecter'}</button></p>
            <p className="auth-privacy">Votre liste est privée : seuls les membres approuvés y ont accès.</p>
          </div>
        </section>
      </main>
    )
  }

  if (!profile || profile.status !== 'approved') {
    return (
      <main className="pending-page">
        <div className="pending-card">
          <Brand />
          <div className="pending-icon">◷</div>
          <span className="eyebrow">DEMANDE EN COURS</span>
          <h1>Un petit instant.</h1>
          <p>{profile?.status === 'revoked'
            ? 'Votre accès à la liste partagée a été révoqué. Contactez un administrateur si vous pensez qu’il s’agit d’une erreur.'
            : 'Votre compte est créé. Un administrateur doit approuver votre accès avant que vous puissiez consulter la liste partagée.'}</p>
          <NoticeView notice={notice} />
          <button className="button button-secondary" onClick={() => sessionUser && void loadProfile(sessionUser.id)}>Vérifier mon accès</button>
          <button className="text-button" onClick={() => void signOut()}>Se déconnecter</button>
        </div>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">ESPACE PARTAGÉ</div>
        <div className="workspace-card"><div className="workspace-icon">⌂</div><div><strong>Ma liste commune</strong><span>{profile.role === 'admin' ? 'Administrateur' : 'Membre approuvé'}</span></div><span className="online-dot" /></div>
        <nav className="side-nav" aria-label="Navigation principale">
          <button className={`nav-item ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}><span className="nav-icon">▦</span>Ma liste<span className="nav-count">{groupProducts.length}</span></button>
          <button className={`nav-item ${activeTab === 'shopping' ? 'active' : ''}`} onClick={() => setActiveTab('shopping')}><span className="nav-icon">✓</span>Courses<span className="nav-count">{groupShoppingItems.filter((item) => !item.is_checked).length}</span></button>
          <button className={`nav-item ${activeTab === 'meals' ? 'active' : ''}`} onClick={() => setActiveTab('meals')}><span className="nav-icon">◷</span>Repas<span className="nav-count">{groupMeals.length}</span></button>
          <button className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')}><span className="nav-icon">▦</span>Calendrier<span className="nav-count">{groupCalendarEvents.length}</span></button>
          {profile.role === 'admin' && <button className={`nav-item ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}><span className="nav-icon">♙</span>Membres{pendingUsers.length > 0 && <span className="nav-count nav-alert">{pendingUsers.length}</span>}</button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><span>✳</span><strong>Un produit manque ?</strong><p>Scannez son code-barres : on cherche ses infos nutritionnelles pour vous.</p><button onClick={openScanner}>Scanner un produit <span>↗</span></button></div>
          <div className="account-row"><div className="avatar">{(profile.full_name || profile.email || 'M').slice(0, 1).toUpperCase()}</div><div className="account-details"><strong>{profile.full_name || 'Membre'}</strong><span>{sessionUser.email}</span></div><button className="signout-button" title="Se déconnecter" onClick={() => void signOut()}>↗</button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Mon espace <span>/</span> <strong>{activeTab === 'products' ? 'Ma liste' : activeTab === 'shopping' ? 'Liste de courses' : activeTab === 'meals' ? 'Repas' : activeTab === 'calendar' ? 'Calendrier' : 'Membres'}</strong></div><div className="topbar-right">
          <div className="group-switcher">
            <label htmlFor="display-zone">AFFICHER LES DONNÉES DE</label>
            <select id="display-zone"             value={activeZoneId ?? ''} onChange={(event) => setSelectedZoneId(event.target.value || null)} disabled={zones.length === 0}>
              <option value="">Tous mes groupes</option>
              {zones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}
            </select>
          </div>
          {activeZoneId === null && zones.length > 1 && (
            <div className="group-switcher">
              <label htmlFor="write-zone">NOUVEAUX ÉLÉMENTS DANS</label>
              <select id="write-zone" value={effectiveWriteZoneId} onChange={(event) => setWriteZoneId(event.target.value)}>
                {zones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}
              </select>
            </div>
          )}
          <span className="sync-indicator"><i /> Espace partagé en direct</span>
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setDarkMode((current) => !current)}
            aria-label={darkMode ? 'Activer le thème clair' : 'Activer le thème sombre'}
            title={darkMode ? 'Activer le thème clair' : 'Activer le thème sombre'}
          >{darkMode ? '☀' : '☾'}</button>
          <div className="topbar-avatar">{(profile.full_name || 'M').slice(0, 1).toUpperCase()}</div>
        </div></header>
        <div className="content-wrap">
          <NoticeView notice={notice} />
          {activeTab === 'products' ? (
            <>
              <section className="page-heading"><div><span className="eyebrow">VOTRE PANIER COLLECTIF</span><h1>La liste des courses<span className="heading-period">.</span></h1><p>Les bons produits, les bonnes infos, au même endroit.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => { setManualOpen(true); setNotice(null) }}>＋ Ajouter manuellement</button><button className="button button-primary add-button" onClick={openScanner}><span className="scan-icon">▣</span>Scanner<span className="button-arrow">↗</span></button></div></section>
              <section className="stats-grid" aria-label="Résumé de la liste">
                <StatCard label="Produits dans la liste" value={groupProducts.length.toString().padStart(2, '0')} caption="références en stock partagé" icon="▦" tone="green" />
                <StatCard label="Mieux notés · A ou B" value={`${healthyProducts}/${gradedProducts.length}`} caption="selon le Nutri-Score" icon="✳" tone="blue" />
                <StatCard label={profile.role === 'admin' ? 'Demandes d’accès' : 'Espace partagé'} value={profile.role === 'admin' ? `${pendingUsers.length}` : '✓'} caption={profile.role === 'admin' ? 'à valider par vous' : 'vous y avez accès'} icon="♙" tone="peach" />
              </section>
              <section className="list-section">
                <div className="list-toolbar"><div><h2>Vos produits <span className="subtle-count">{groupProducts.length}</span></h2><p>Mis à jour par les membres de votre groupe.</p></div><div className="list-actions"><button className="button button-secondary" onClick={() => void copyProducts()}>Copier toute la liste</button><label className="search-box"><span>⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un produit…" /></label></div></div>
                {Object.keys(selectedProducts).some((id) => visibleProducts.some((product) => product.id === id)) && <div className="consume-bar"><span>{visibleProducts.filter((product) => selectedProducts[product.id] !== undefined).length} produit(s) sélectionné(s) — saisissez la quantité consommée dans chaque ligne.</span><button className="button button-primary" onClick={() => void consumeSelected()}>Enregistrer la consommation</button><button className="text-button" onClick={() => setSelectedProducts({})}>Annuler</button></div>}
                {groupProducts.length === 0 ? <EmptyState onScan={openScanner} /> : visibleProducts.length === 0 ? <div className="empty-filter">Aucun produit ne correspond à « {search} ».</div> : (
                  <div className="product-table-wrap"><table className="product-table"><thead><tr><th>CONSOMMÉ</th><th>PRODUIT</th><th>CATÉGORIE</th><th>NUTRI-SCORE</th><th>STOCK</th><th>AJUSTEMENT</th></tr></thead><tbody>
                    {visibleProducts.map((product) => <ProductRow key={product.id} product={product} groupName={showGroupNames ? getZoneName(product.zone_id) : undefined} selected={selectedProducts[product.id] !== undefined} consumeAmount={selectedProducts[product.id] ?? 1} onSelect={(checked) => setSelectedProducts((current) => { const next = { ...current }; if (checked) next[product.id] = 1; else delete next[product.id]; return next })} onConsumeAmount={(amount) => setSelectedProducts((current) => ({ ...current, [product.id]: amount }))} onQuantity={(delta) => void changeQuantity(product, delta)} />)}
                  </tbody></table></div>
                )}
                <div className="source-note"><span>ⓘ</span> Notes nutritionnelles fournies par <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts</a>. Le Nutri-Score ne remplace pas un avis médical.</div>
              </section>
            </>
          ) : activeTab === 'shopping' ? (
            <section className="shopping-section">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">LISTE PARTAGÉE</span>
                  <h1>Liste de courses<span className="heading-period">.</span></h1>
                  <p>Ajoutez les achats à prévoir et cochez-les au fur et à mesure.</p>
                </div>
              </div>
              <form className="shopping-add-form" onSubmit={(event) => void addShoppingItem(event)}>
                <label className="visually-hidden" htmlFor="shopping-item-name">Article à ajouter</label>
                <input
                  id="shopping-item-name"
                  value={shoppingItemName}
                  onChange={(event) => setShoppingItemName(event.target.value)}
                  placeholder="Ex. lait, pommes, pain…"
                  maxLength={120}
                  required
                />
                <button className="button button-primary" type="submit" disabled={addingShoppingItem || !shoppingItemName.trim() || !creationZoneId}>
                  {addingShoppingItem ? 'Ajout…' : '＋ Ajouter'}
                </button>
              </form>
              <div className="shopping-list-panel">
                <div className="shopping-list-heading">
                  <div>
                    <h2>À acheter <span className="subtle-count">{groupShoppingItems.filter((item) => !item.is_checked).length}</span></h2>
                    <p>La liste est partagée avec tous les membres.</p>
                  </div>
                  {groupShoppingItems.some((item) => item.is_checked) && (
                    <button className="text-button" type="button" onClick={() => void clearCheckedShoppingItems()}>
                      Effacer les articles cochés
                    </button>
                  )}
                </div>
                {groupShoppingItems.length === 0 ? (
                  <div className="no-pending">
                    <span>✓</span>
                    <strong>La liste est vide.</strong>
                    <p>Ajoutez les articles à acheter ci-dessus.</p>
                  </div>
                ) : (
                  <ul className="shopping-items">
                    {groupShoppingItems.map((item) => (
                      <li className={`shopping-item ${item.is_checked ? 'checked' : ''}`} key={item.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={item.is_checked}
                            onChange={() => void toggleShoppingItem(item)}
                            aria-label={`${item.is_checked ? 'Décocher' : 'Cocher'} ${item.name}`}
                          />
                          <span>{item.name}</span>
                        </label>
                        {showGroupNames && <span className="group-badge">{getZoneName(item.zone_id)}</span>}
                        <button
                          className="shopping-delete"
                          type="button"
                          title={`Supprimer ${item.name}`}
                          aria-label={`Supprimer ${item.name}`}
                          onClick={() => void deleteShoppingItem(item)}
                        >×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : activeTab === 'meals' ? (
            <section className="meals-section">
              <div className="page-heading"><div><span className="eyebrow">PLANIFICATION PARTAGÉE</span><h1>Les repas<span className="heading-period">.</span></h1><p>Organisez les repas à venir avec votre groupe.</p></div></div>
              <form className="meal-form" onSubmit={(event) => void addMeal(event)}>
                <label>Nom du repas<input value={mealName} onChange={(event) => setMealName(event.target.value)} placeholder="Ex. soupe de légumes" required maxLength={120} /></label>
                <label>Date prévue<input type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} /></label>
                <label className="meal-notes">Notes<textarea value={mealNotes} onChange={(event) => setMealNotes(event.target.value)} placeholder="Idées, préparation…" maxLength={500} /></label>
                <button className="button button-primary" disabled={savingMeal || !creationZoneId}>{savingMeal ? 'Ajout…' : 'Ajouter au planning'}</button>
              </form>
              <div className="meal-list"><h2>Planning commun <span className="subtle-count">{groupMeals.length}</span></h2>{groupMeals.length === 0 ? <div className="empty-filter">Aucun repas planifié pour le moment.</div> : groupMeals.map((meal) => <article className="meal-card" key={meal.id}><div className="meal-date">{meal.planned_for ? new Date(`${meal.planned_for}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—'}</div><div className="meal-details"><strong>{meal.name}</strong>{meal.planned_for && <span>{new Date(`${meal.planned_for}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>}{meal.notes && <p>{meal.notes}</p>}{showGroupNames && <span className="group-badge">{getZoneName(meal.zone_id)}</span>}</div><button className="text-button" onClick={() => void deleteMeal(meal)}>Supprimer</button></article>)}</div>
            </section>
          ) : activeTab === 'calendar' ? (
            <section className="calendar-section">
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">VOTRE AGENDA PARTAGÉ</span>
                      <h1>Calendrier<span className="heading-period">.</span></h1>
                      <p>Créez et partagez des événements avec votre groupe.</p>
                      <p className="calendar-import-note">Les événements récurrents des fichiers .ics ne sont pas importés.</p>
                    </div>
                    <div className="heading-actions calendar-actions">
                      <input
                        ref={calendarFileInput}
                        className="calendar-file-input"
                        type="file"
                        accept=".ics,text/calendar"
                        aria-label="Importer un fichier iCalendar"
                        onChange={(event) => void importCalendarFile(event)}
                      />
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={importingCalendar}
                        onClick={() => calendarFileInput.current?.click()}
                      >{importingCalendar ? 'Import…' : 'Importer .ics'}</button>
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={groupCalendarEvents.length === 0}
                        onClick={exportCalendar}
                      >Exporter .ics</button>
                      <button className="button button-primary" type="button" disabled={!creationZoneId} onClick={() => openCalendarEvent()}>＋ Événement</button>
                    </div>
                  </div>
                  <div className="calendar-event-count">{groupCalendarEvents.length} événement(s) partagé(s)</div>
                  <Suspense fallback={<div className="meal-calendar calendar-loading">Chargement du calendrier…</div>}>
                    <SharedCalendar
                      events={groupCalendarEvents}
                      zoneNames={Object.fromEntries(zones.map((zone) => [zone.id, zone.name]))}
                      showGroupNames={showGroupNames}
                      onDateClick={(date, allDay) => openCalendarEvent(date, allDay)}
                      onEventClick={(id) => {
                        const event = groupCalendarEvents.find((item) => item.id === id)
                        if (event) editCalendarEvent(event)
                      }}
                      onMove={(event, revert) => void moveCalendarEvent(event, revert)}
                    />
                  </Suspense>
                  {groupCalendarEvents.length === 0 && (
                    <p className="calendar-empty-hint">Cliquez sur une date ou sur « Événement » pour ajouter le premier rendez-vous.</p>
                  )}
            </section>
          ) : (
            <section className="members-section">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">GESTION DE L’ESPACE</span>
                  <h1>Les membres<span className="heading-period">.</span></h1>
                  <p>Gérez les groupes, les accès de chaque membre et leur dernière connexion.</p>
                </div>
              </div>
              <div className="member-panel">
                <div className="member-panel-heading">
                  <div><h2>Groupes</h2><p>Les données sont visibles uniquement par les membres de chaque groupe.</p></div>
                  <span className="pending-pill">{zones.length} groupe(s)</span>
                </div>
                <form className="group-create-form" onSubmit={(event) => void createZone(event)}>
                  <label htmlFor="new-zone-name">Nom du nouveau groupe</label>
                  <input id="new-zone-name" value={newZoneName} onChange={(event) => setNewZoneName(event.target.value)} placeholder="Ex. Famille, Colocation…" required maxLength={80} />
                  <button className="button button-primary" type="submit" disabled={savingZone || !newZoneName.trim()}>{savingZone ? 'Création…' : 'Créer le groupe'}</button>
                </form>
                <div className="group-edit-list">
                  {zones.map((zone) => (
                    <form className="group-edit-row" key={zone.id} onSubmit={(event) => { event.preventDefault(); void renameZone(zone) }}>
                      <label htmlFor={`zone-name-${zone.id}`}>Nom du groupe</label>
                      <input id={`zone-name-${zone.id}`} value={zoneNameEdits[zone.id] ?? zone.name} onChange={(event) => setZoneNameEdits((current) => ({ ...current, [zone.id]: event.target.value }))} maxLength={80} required />
                      <button className="button button-secondary" type="submit" disabled={(zoneNameEdits[zone.id] ?? zone.name).trim() === zone.name}>Renommer</button>
                    </form>
                  ))}
                </div>
              </div>
              <div className="member-panel">
                <div className="member-panel-heading">
                  <div><h2>Comptes autorisés</h2><p>Dernière connexion enregistrée pour chaque compte.</p></div>
                  <span className="pending-pill">{memberUsers.filter((user) => user.status === 'approved').length} actifs</span>
                </div>
                {memberUsers.filter((user) => user.status === 'approved').length === 0 ? (
                  <div className="no-pending"><span>—</span><strong>Aucun compte autorisé.</strong><p>Les comptes approuvés apparaîtront ici.</p></div>
                ) : (
                  <div className="pending-list">
                    {memberUsers.filter((user) => user.status === 'approved').map((user) => (
                      <div className="pending-member" key={user.id}>
                        <div className="avatar">{(user.full_name || user.email || 'M').slice(0, 1).toUpperCase()}</div>
                        <div className="member-info">
                          <strong>{user.full_name || 'Membre'}</strong>
                          <span>{user.email}</span>
                        </div>
                        <span className="member-date">
                          Dernière connexion : {user.last_sign_in_at
                            ? new Date(user.last_sign_in_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
                            : 'Jamais'}
                        </span>
                        {user.role === 'admin'
                          ? <span className="role-pill">Administrateur</span>
                          : user.id === sessionUser?.id
                            ? <span className="role-pill">Vous</span>
                            : <button
                              className="button revoke-button"
                              disabled={revokingUserId === user.id}
                              onClick={() => void revokeUser(user)}
                            >{revokingUserId === user.id ? 'Révocation…' : 'Révoquer l’accès'}</button>}
                        {zones.length > 0 && (
                          <details className="member-groups">
                            <summary>Groupes ({zoneMemberships.filter((item) => item.user_id === user.id).length})</summary>
                            <div className="member-group-options">
                              {zones.map((zone) => {
                                const isMember = zoneMemberships.some((item) => item.zone_id === zone.id && item.user_id === user.id)
                                return (
                                  <label key={zone.id}>
                                    <input type="checkbox" checked={isMember} onChange={(event) => void changeZoneMembership(user, zone, event.target.checked)} />
                                    {zone.name}
                                  </label>
                                )
                              })}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {memberUsers.some((user) => user.status === 'revoked') && (
                <div className="member-panel">
                  <div className="member-panel-heading">
                    <div><h2>Accès révoqués</h2><p>Ces comptes ne peuvent plus accéder à l’espace partagé.</p></div>
                    <span className="revoked-pill">{memberUsers.filter((user) => user.status === 'revoked').length}</span>
                  </div>
                  <div className="pending-list">
                    {memberUsers.filter((user) => user.status === 'revoked').map((user) => (
                      <div className="pending-member" key={user.id}>
                        <div className="avatar">{(user.full_name || user.email || 'M').slice(0, 1).toUpperCase()}</div>
                        <div className="member-info"><strong>{user.full_name || 'Membre'}</strong><span>{user.email}</span></div>
                        <span className="member-date">Dernière connexion : {user.last_sign_in_at
                          ? new Date(user.last_sign_in_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
                          : 'Jamais'}</span>
                        <button
                          className="button button-primary approve-button"
                          disabled={revokingUserId === user.id}
                          onClick={() => void approveUser(user)}
                        >Rétablir l’accès <span>✓</span></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="member-panel">
                <div className="member-panel-heading">
                  <div><h2>Demandes d’accès</h2><p>Chaque demande doit être approuvée par un administrateur.</p></div>
                  <span className="pending-pill">{pendingUsers.length} en attente</span>
                </div>
                {pendingUsers.length === 0 ? (
                  <div className="no-pending"><span>✓</span><strong>Tout est à jour.</strong><p>Aucune demande d’accès en attente.</p></div>
                ) : (
                  <div className="pending-list">
                    {pendingUsers.map((user) => (
                      <div className="pending-member" key={user.id}>
                        <div className="avatar">{(user.full_name || user.email || 'M').slice(0, 1).toUpperCase()}</div>
                        <div className="member-info"><strong>{user.full_name || 'Nouveau membre'}</strong><span>{user.email}</span></div>
                        <span className="member-date">{new Date(user.created_at).toLocaleDateString('fr-FR')}</span>
                        <button className="button button-primary approve-button" onClick={() => void approveUser(user)}>Approuver <span>✓</span></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
        <footer className="footer"><span>NutriScan <span className="footer-dot">·</span> Votre espace, à partager.</span><span>Une alimentation plus éclairée, ensemble.</span></footer>
      </main>

      {eventModalOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setEventModalOpen(false) }}
        >
          <section className="scanner-modal calendar-event-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title">
            <button className="modal-close" type="button" onClick={() => setEventModalOpen(false)} aria-label="Fermer">×</button>
            <span className="eyebrow">AGENDA PARTAGÉ</span>
            <h2 id="calendar-event-title">{editingEventId ? 'Modifier l’événement' : 'Nouvel événement'}</h2>
            <form className="calendar-event-form" onSubmit={(event) => void saveCalendarEvent(event)}>
              <label>Titre<input value={calendarEventTitle} onChange={(event) => setCalendarEventTitle(event.target.value)} placeholder="Ex. rendez-vous médical" required maxLength={160} autoFocus /></label>
              <label className="calendar-all-day">
                <input type="checkbox" checked={calendarEventAllDay} onChange={(event) => setCalendarEventAllDay(event.target.checked)} />
                Toute la journée
              </label>
              <label>Début<input
                type={calendarEventAllDay ? 'date' : 'datetime-local'}
                value={calendarEventAllDay ? calendarEventStart.slice(0, 10) : calendarEventStart}
                onChange={(event) => setCalendarEventStart(calendarEventAllDay ? `${event.target.value}T09:00` : event.target.value)}
                required
              /></label>
              <label>Fin<input
                type={calendarEventAllDay ? 'date' : 'datetime-local'}
                value={calendarEventAllDay ? calendarEventEnd.slice(0, 10) : calendarEventEnd}
                onChange={(event) => setCalendarEventEnd(calendarEventAllDay ? `${event.target.value}T10:00` : event.target.value)}
                required
              /></label>
              <label className="calendar-color-field">Couleur de l’événement<input type="color" value={calendarEventColor} onChange={(event) => setCalendarEventColor(event.target.value)} /></label>
              <label className="calendar-description">Description<textarea
                value={calendarEventDescription}
                onChange={(event) => setCalendarEventDescription(event.target.value)}
                placeholder="Ajouter des détails…"
                maxLength={4000}
                rows={4}
              /></label>
              <div className="calendar-event-form-actions">
                {editingEventId && <button className="button calendar-delete-button" type="button" onClick={() => void deleteCalendarEvent()}>Supprimer</button>}
                <button className="button button-secondary" type="button" onClick={() => setEventModalOpen(false)}>Annuler</button>
                <button className="button button-primary" type="submit" disabled={savingCalendarEvent}>{savingCalendarEvent ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {manualOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setManualOpen(false) }}><section className="scanner-modal manual-modal" role="dialog" aria-modal="true" aria-labelledby="manual-title"><button className="modal-close" onClick={() => setManualOpen(false)} aria-label="Fermer">×</button><span className="eyebrow">AJOUTER À LA LISTE</span><h2 id="manual-title">Saisie manuelle</h2><p className="modal-description">Ajoutez un produit même s’il n’a pas de code-barres.</p><form className="manual-form" onSubmit={(event) => void saveManualProduct(event)}><label>Nom du produit<input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Ex. farine de blé" required maxLength={120} /></label><label>Quantité<input type="number" min="0.001" step="0.001" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} required /></label><label>Unité<select value={manualUnit} onChange={(event) => setManualUnit(event.target.value)}><option>unité</option><option>g</option><option>kg</option><option>ml</option><option>l</option></select></label><label>Date de péremption<input type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} /></label><button className="button button-primary button-wide" disabled={savingProduct}>{savingProduct ? 'Ajout en cours…' : 'Ajouter à la liste'}<span>↗</span></button></form></section></div>}
      {scannerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScannerOpen(false) }}><section className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title"><button className="modal-close" onClick={() => setScannerOpen(false)} aria-label="Fermer">×</button><span className="eyebrow">AJOUTER À LA LISTE</span><h2 id="scanner-title">Scanner un produit</h2><p className="modal-description">Pointez la caméra sur le code-barres du produit.</p><div className="scanner-frame">{scannerOpen && <div id="qr-reader" />}{!scanning && <div className="scanner-placeholder"><span>▣</span><p>Autorisez l’accès à la caméra<br />pour scanner le code-barres.</p></div>}</div><div className="scanner-divider"><span>OU SAISIR LE CODE</span></div><form className="barcode-form" onSubmit={(event) => void lookupProduct(event)}><input value={barcode} onChange={(event) => { setBarcode(event.target.value); setFoundProduct(null) }} placeholder="Ex. 3017620422003" inputMode="numeric" aria-label="Code-barres du produit" /><button className="button button-primary" disabled={lookupBusy || !barcode.trim()}>{lookupBusy ? 'Recherche…' : 'Rechercher'}</button></form>{foundProduct && <div className="found-product"><ProductPreview data={foundProduct.data} /><div className="product-entry-fields"><label>Quantité<input type="number" min="0.001" step="0.001" value={newAmount} onChange={(event) => setNewAmount(event.target.value)} /></label><label>Unité<select value={newUnit} onChange={(event) => setNewUnit(event.target.value)}><option>unité</option><option>g</option><option>kg</option><option>ml</option><option>l</option></select></label><label>Date de péremption<input type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} /></label></div><button className="button button-primary button-wide" onClick={() => void saveProduct()} disabled={savingProduct || !Number.isFinite(Number(newAmount)) || Number(newAmount) <= 0}>{savingProduct ? 'Ajout en cours…' : 'Ajouter à la liste partagée'}<span>↗</span></button></div>}<p className="scanner-privacy">L’accès caméra est utilisé uniquement pour lire le code-barres.</p></section></div>}
    </div>
  )
}

function parsePack(label: string | null | undefined): { amount: number; unit: string } {
  const text = label?.trim().toLocaleLowerCase('fr') ?? ''
  const count = text.match(/(\d+(?:[.,]\d+)?)\s*(?:x|×)\s*\d/)
  if (count) return { amount: Number(count[1].replace(',', '.')), unit: 'unité' }
  const pieces = text.match(/(\d+)\s*(?:œufs|oeufs|unités|unité)\b/)
  if (pieces) return { amount: Number(pieces[1]), unit: 'unité' }
  const massOrVolume = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|cl)\b/)
  if (massOrVolume) {
    const amount = Number(massOrVolume[1].replace(',', '.'))
    return massOrVolume[2] === 'cl'
      ? { amount: amount * 10, unit: 'ml' }
      : { amount, unit: massOrVolume[2] }
  }
  return { amount: 1, unit: 'unité' }
}

function authMessage(error: unknown) {
  if (!(error instanceof Error)) return 'La connexion a échoué. Réessayez.'
  if (error.message.toLowerCase().includes('invalid login credentials')) return 'Email ou mot de passe incorrect.'
  if (error.message.toLowerCase().includes('user already registered')) return 'Un compte existe déjà avec cet email.'
  if (error.message.toLowerCase().includes('database error saving new user')) return 'Supabase a refusé la création du compte. La limite de 10 comptes est peut-être atteinte ; contactez l’administrateur.'
  return error.message
}

function Brand() {
  return <div className="brand"><span className="brand-mark">n</span><span>nutri<span>scan</span></span></div>
}

function NoticeView({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  return <div className={`notice notice-${notice.type}`} role="status"><span>{notice.type === 'success' ? '✓' : notice.type === 'error' ? '!' : 'ⓘ'}</span>{notice.text}</div>
}

function StatCard({ label, value, caption, icon, tone }: { label: string; value: string; caption: string; icon: string; tone: string }) {
  return <article className="stat-card"><div className="stat-card-top"><span>{label}</span><span className={`stat-icon stat-${tone}`}>{icon}</span></div><div className="stat-value">{value}</div><div className="stat-caption">{caption}</div></article>
}

function ProductRow({ product, groupName, selected, consumeAmount, onSelect, onConsumeAmount, onQuantity }: { product: Product; groupName?: string; selected: boolean; consumeAmount: number; onSelect: (checked: boolean) => void; onConsumeAmount: (amount: number) => void; onQuantity: (delta: number) => void }) {
  const grade = product.nutriscore?.toLowerCase()
  return <tr><td><div className="consume-select"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Sélectionner ${product.product_name} comme consommé`} />{selected && <input className="consume-amount" type="number" min="0.001" max={product.quantity} step="0.001" value={consumeAmount} onChange={(event) => onConsumeAmount(Number(event.target.value))} aria-label={`Quantité consommée de ${product.product_name}`} />}</div></td><td><div className="product-cell">{product.image_url ? <img className="product-image" src={product.image_url} alt="" loading="lazy" /> : <div className="product-placeholder">✳</div>}<div className="product-info"><strong>{product.product_name}</strong><span>{product.brand || product.barcode}{product.quantity_label ? ` · ${product.quantity_label}` : ''}{product.expiration_date ? ` · Expire le ${new Date(`${product.expiration_date}T12:00:00`).toLocaleDateString('fr-FR')}` : ''}</span>{groupName && <span className="group-badge">{groupName}</span>}</div></div></td><td><span className="category-label">{product.category || 'Autre'}</span></td><td>{grade ? <span className={`score-badge grade-${grade}`}><strong>{grade.toUpperCase()}</strong><span>{gradeLabels[grade] || 'Nutri-Score'}</span></span> : <span className="score-unavailable">Non noté</span>}{product.nova_group && <span className="nova-label">NOVA {product.nova_group}</span>}</td><td><strong className="quantity-number">{product.quantity}</strong> <span className="quantity-unit">{product.quantity_unit}</span></td><td><div className="quantity-control"><button onClick={() => onQuantity(-1)} aria-label={`Retirer une unité de ${product.product_name}`}>−</button><span>{product.quantity}</span><button onClick={() => onQuantity(1)} aria-label={`Ajouter une unité de ${product.product_name}`}>+</button></div></td></tr>
}

function ProductPreview({ data }: { data: OffProduct }) {
  const grade = (data.nutriscore_grade || data.nutrition_grades || '').toLowerCase()
  return <div className="preview-card">{data.image_front_small_url ? <img src={data.image_front_small_url} alt="" /> : <div className="product-placeholder">✳</div>}<div className="preview-info"><strong>{data.product_name || 'Produit sans nom'}</strong><span>{[data.brands, data.quantity].filter(Boolean).join(' · ') || 'Informations complémentaires indisponibles'}</span></div>{grade && /^[a-e]$/.test(grade) && <span className={`score-badge grade-${grade}`}><strong>{grade.toUpperCase()}</strong><span>{gradeLabels[grade]}</span></span>}</div>
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return <div className="empty-state"><div className="empty-illustration"><span>✳</span><span>▦</span><span>●</span></div><span className="eyebrow">C’EST LE DÉBUT</span><h3>Votre liste n’attend que vous.</h3><p>Scannez le code-barres d’un produit pour voir ses informations nutritionnelles et l’ajouter à votre espace partagé.</p><button className="button button-primary" onClick={onScan}>Scanner le premier produit <span>↗</span></button></div>
}

function SetupScreen() {
  return <main className="setup-page"><div className="setup-card"><Brand /><span className="eyebrow">CONFIGURATION REQUISE</span><h1>Connectez votre espace partagé.</h1><p>En local, renseignez l’URL de votre projet Supabase et sa clé publique anon dans <code>.env.local</code>, puis redémarrez le serveur.</p><pre>{'VITE_SUPABASE_URL=https://votre-projet.supabase.co\nVITE_SUPABASE_ANON_KEY=votre-cle-publique'}</pre><p>Sur GitHub Pages, ajoutez ces valeurs comme secrets d’Actions nommés <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code>, puis relancez le déploiement. Ne mettez jamais une clé <code>service_role</code> dans le site.</p></div></main>
}

export default App
