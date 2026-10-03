import { useCallback, useEffect, useState } from 'react'
import type { Html5Qrcode } from 'html5-qrcode'
import type { FormEvent } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import type { Meal, Product, Profile } from './lib/supabase'
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

const gradeLabels: Record<string, string> = {
  a: 'Excellent',
  b: 'Très bien',
  c: 'Bien',
  d: 'Médiocre',
  e: 'À limiter',
}

function App() {
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [meals, setMeals] = useState<Meal[]>([])
  const [pendingUsers, setPendingUsers] = useState<Profile[]>([])
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
  const [activeTab, setActiveTab] = useState<'products' | 'meals' | 'members'>('products')
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

  const loadPendingUsers = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('status', 'pending').order('created_at')
    if (error) {
      setNotice({ type: 'error', text: `Impossible de charger les demandes : ${error.message}` })
      return
    }
    setPendingUsers(data ?? [])
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
      void loadMeals()
      if (data.role === 'admin') void loadPendingUsers()
    }
  }, [loadProducts, loadMeals, loadPendingUsers])

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
        if (profileData.role === 'admin') {
          const { data: pendingData, error: pendingError } = await supabase.from('profiles').select('*').eq('status', 'pending').order('created_at')
          if (pendingError) setNotice({ type: 'error', text: `Impossible de charger les demandes : ${pendingError.message}` })
          if (active) setPendingUsers(pendingData ?? [])
        }
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
        setMeals([])
        setPendingUsers([])
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => void loadMeals())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        if (profile.role === 'admin') void loadPendingUsers()
        if (sessionUser) void loadProfile(sessionUser.id)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadProducts, loadMeals, loadPendingUsers, loadProfile, profile, sessionUser])

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
    const { error } = await supabase.from('profiles').update({ status: 'approved' }).eq('id', user.id)
    if (error) {
      setNotice({ type: 'error', text: `Approbation impossible : ${error.message}` })
      return
    }
    setNotice({ type: 'success', text: `${user.full_name || user.email} peut maintenant accéder à la liste.` })
    await loadPendingUsers()
  }

  async function lookupProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await lookupBarcode(barcode)
  }

  async function saveProduct() {
    if (!foundProduct || !sessionUser) return
    setSavingProduct(true)
    setNotice(null)
    const grade = (foundProduct.data.nutriscore_grade || foundProduct.data.nutrition_grades || '').toLowerCase()
    const { data: existing, error: findError } = await supabase.from('products').select('id, quantity, quantity_unit, expiration_date').eq('barcode', foundProduct.barcode).maybeSingle()
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
    if (!sessionUser) return
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
    const selected = products.filter((product) => selectedProducts[product.id] !== undefined)
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
    const text = products.map((product) =>
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
    if (!sessionUser) return
    setSavingMeal(true)
    const { error } = await supabase.from('meals').insert({
      name: mealName.trim(),
      planned_for: mealDate || null,
      notes: mealNotes.trim() || null,
      created_by: sessionUser.id,
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

  function openScanner() {
    setNotice(null)
    setScannerOpen(true)
  }

  const visibleProducts = products.filter((product) => {
    const query = search.trim().toLocaleLowerCase('fr')
    return !query || `${product.product_name} ${product.brand ?? ''} ${product.category ?? ''} ${product.barcode}`.toLocaleLowerCase('fr').includes(query)
  })
  const gradedProducts = products.filter((product) => product.nutriscore)
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
          <p>Votre compte est créé. Un administrateur doit approuver votre accès avant que vous puissiez consulter la liste partagée.</p>
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
          <button className={`nav-item ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}><span className="nav-icon">▦</span>Ma liste<span className="nav-count">{products.length}</span></button>
          <button className={`nav-item ${activeTab === 'meals' ? 'active' : ''}`} onClick={() => setActiveTab('meals')}><span className="nav-icon">◷</span>Repas<span className="nav-count">{meals.length}</span></button>
          {profile.role === 'admin' && <button className={`nav-item ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}><span className="nav-icon">♙</span>Membres{pendingUsers.length > 0 && <span className="nav-count nav-alert">{pendingUsers.length}</span>}</button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><span>✳</span><strong>Un produit manque ?</strong><p>Scannez son code-barres : on cherche ses infos nutritionnelles pour vous.</p><button onClick={openScanner}>Scanner un produit <span>↗</span></button></div>
          <div className="account-row"><div className="avatar">{(profile.full_name || profile.email || 'M').slice(0, 1).toUpperCase()}</div><div className="account-details"><strong>{profile.full_name || 'Membre'}</strong><span>{sessionUser.email}</span></div><button className="signout-button" title="Se déconnecter" onClick={() => void signOut()}>↗</button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb">Mon espace <span>/</span> <strong>{activeTab === 'products' ? 'Courses' : activeTab === 'meals' ? 'Repas' : 'Membres'}</strong></div><div className="topbar-right"><span className="sync-indicator"><i /> Espace partagé en direct</span><div className="topbar-avatar">{(profile.full_name || 'M').slice(0, 1).toUpperCase()}</div></div></header>
        <div className="content-wrap">
          <NoticeView notice={notice} />
          {activeTab === 'products' ? (
            <>
              <section className="page-heading"><div><span className="eyebrow">VOTRE PANIER COLLECTIF</span><h1>La liste des courses<span className="heading-period">.</span></h1><p>Les bons produits, les bonnes infos, au même endroit.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => { setManualOpen(true); setNotice(null) }}>＋ Ajouter manuellement</button><button className="button button-primary add-button" onClick={openScanner}><span className="scan-icon">▣</span>Scanner<span className="button-arrow">↗</span></button></div></section>
              <section className="stats-grid" aria-label="Résumé de la liste">
                <StatCard label="Produits dans la liste" value={products.length.toString().padStart(2, '0')} caption="références en stock partagé" icon="▦" tone="green" />
                <StatCard label="Mieux notés · A ou B" value={`${healthyProducts}/${gradedProducts.length}`} caption="selon le Nutri-Score" icon="✳" tone="blue" />
                <StatCard label={profile.role === 'admin' ? 'Demandes d’accès' : 'Espace partagé'} value={profile.role === 'admin' ? `${pendingUsers.length}` : '✓'} caption={profile.role === 'admin' ? 'à valider par vous' : 'vous y avez accès'} icon="♙" tone="peach" />
              </section>
              <section className="list-section">
                <div className="list-toolbar"><div><h2>Vos produits <span className="subtle-count">{products.length}</span></h2><p>Mis à jour par les membres de votre groupe.</p></div><div className="list-actions"><button className="button button-secondary" onClick={() => void copyProducts()}>Copier toute la liste</button><label className="search-box"><span>⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un produit…" /></label></div></div>
                {Object.keys(selectedProducts).length > 0 && <div className="consume-bar"><span>{Object.keys(selectedProducts).length} produit(s) sélectionné(s) — saisissez la quantité consommée dans chaque ligne.</span><button className="button button-primary" onClick={() => void consumeSelected()}>Enregistrer la consommation</button><button className="text-button" onClick={() => setSelectedProducts({})}>Annuler</button></div>}
                {products.length === 0 ? <EmptyState onScan={openScanner} /> : visibleProducts.length === 0 ? <div className="empty-filter">Aucun produit ne correspond à « {search} ».</div> : (
                  <div className="product-table-wrap"><table className="product-table"><thead><tr><th>CONSOMMÉ</th><th>PRODUIT</th><th>CATÉGORIE</th><th>NUTRI-SCORE</th><th>STOCK</th><th>AJUSTEMENT</th></tr></thead><tbody>
                    {visibleProducts.map((product) => <ProductRow key={product.id} product={product} selected={selectedProducts[product.id] !== undefined} consumeAmount={selectedProducts[product.id] ?? 1} onSelect={(checked) => setSelectedProducts((current) => { const next = { ...current }; if (checked) next[product.id] = 1; else delete next[product.id]; return next })} onConsumeAmount={(amount) => setSelectedProducts((current) => ({ ...current, [product.id]: amount }))} onQuantity={(delta) => void changeQuantity(product, delta)} />)}
                  </tbody></table></div>
                )}
                <div className="source-note"><span>ⓘ</span> Notes nutritionnelles fournies par <a href="https://world.openfoodfacts.org/" target="_blank" rel="noreferrer">Open Food Facts</a>. Le Nutri-Score ne remplace pas un avis médical.</div>
              </section>
            </>
          ) : activeTab === 'meals' ? (
            <section className="meals-section">
              <div className="page-heading"><div><span className="eyebrow">PLANIFICATION PARTAGÉE</span><h1>Les repas<span className="heading-period">.</span></h1><p>Organisez les repas à venir avec votre groupe.</p></div></div>
              <form className="meal-form" onSubmit={(event) => void addMeal(event)}>
                <label>Nom du repas<input value={mealName} onChange={(event) => setMealName(event.target.value)} placeholder="Ex. soupe de légumes" required maxLength={120} /></label>
                <label>Date prévue<input type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} /></label>
                <label className="meal-notes">Notes<textarea value={mealNotes} onChange={(event) => setMealNotes(event.target.value)} placeholder="Idées, préparation…" maxLength={500} /></label>
                <button className="button button-primary" disabled={savingMeal}>{savingMeal ? 'Ajout…' : 'Ajouter au planning'}</button>
              </form>
              <div className="meal-list"><h2>Planning commun <span className="subtle-count">{meals.length}</span></h2>{meals.length === 0 ? <div className="empty-filter">Aucun repas planifié pour le moment.</div> : meals.map((meal) => <article className="meal-card" key={meal.id}><div className="meal-date">{meal.planned_for ? new Date(`${meal.planned_for}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—'}</div><div className="meal-details"><strong>{meal.name}</strong>{meal.planned_for && <span>{new Date(`${meal.planned_for}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>}{meal.notes && <p>{meal.notes}</p>}</div><button className="text-button" onClick={() => void deleteMeal(meal)}>Supprimer</button></article>)}</div>
            </section>
          ) : (
            <section className="members-section"><div className="page-heading"><div><span className="eyebrow">GESTION DE L’ESPACE</span><h1>Les membres<span className="heading-period">.</span></h1><p>Validez les personnes qui peuvent rejoindre votre liste partagée.</p></div></div><div className="member-panel"><div className="member-panel-heading"><div><h2>Demandes d’accès</h2><p>Chaque demande doit être approuvée par un administrateur.</p></div><span className="pending-pill">{pendingUsers.length} en attente</span></div>{pendingUsers.length === 0 ? <div className="no-pending"><span>✓</span><strong>Tout est à jour.</strong><p>Aucune demande d’accès en attente.</p></div> : <div className="pending-list">{pendingUsers.map((user) => <div className="pending-member" key={user.id}><div className="avatar">{(user.full_name || user.email || 'M').slice(0, 1).toUpperCase()}</div><div className="member-info"><strong>{user.full_name || 'Nouveau membre'}</strong><span>{user.email}</span></div><span className="member-date">{new Date(user.created_at).toLocaleDateString('fr-FR')}</span><button className="button button-primary approve-button" onClick={() => void approveUser(user)}>Approuver <span>✓</span></button></div>)}</div>}</div></section>
          )}
        </div>
        <footer className="footer"><span>NutriScan <span className="footer-dot">·</span> Votre espace, à partager.</span><span>Une alimentation plus éclairée, ensemble.</span></footer>
      </main>

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

function ProductRow({ product, selected, consumeAmount, onSelect, onConsumeAmount, onQuantity }: { product: Product; selected: boolean; consumeAmount: number; onSelect: (checked: boolean) => void; onConsumeAmount: (amount: number) => void; onQuantity: (delta: number) => void }) {
  const grade = product.nutriscore?.toLowerCase()
  return <tr><td><div className="consume-select"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Sélectionner ${product.product_name} comme consommé`} />{selected && <input className="consume-amount" type="number" min="0.001" max={product.quantity} step="0.001" value={consumeAmount} onChange={(event) => onConsumeAmount(Number(event.target.value))} aria-label={`Quantité consommée de ${product.product_name}`} />}</div></td><td><div className="product-cell">{product.image_url ? <img className="product-image" src={product.image_url} alt="" loading="lazy" /> : <div className="product-placeholder">✳</div>}<div className="product-info"><strong>{product.product_name}</strong><span>{product.brand || product.barcode}{product.quantity_label ? ` · ${product.quantity_label}` : ''}{product.expiration_date ? ` · Expire le ${new Date(`${product.expiration_date}T12:00:00`).toLocaleDateString('fr-FR')}` : ''}</span></div></div></td><td><span className="category-label">{product.category || 'Autre'}</span></td><td>{grade ? <span className={`score-badge grade-${grade}`}><strong>{grade.toUpperCase()}</strong><span>{gradeLabels[grade] || 'Nutri-Score'}</span></span> : <span className="score-unavailable">Non noté</span>}{product.nova_group && <span className="nova-label">NOVA {product.nova_group}</span>}</td><td><strong className="quantity-number">{product.quantity}</strong> <span className="quantity-unit">{product.quantity_unit}</span></td><td><div className="quantity-control"><button onClick={() => onQuantity(-1)} aria-label={`Retirer une unité de ${product.product_name}`}>−</button><span>{product.quantity}</span><button onClick={() => onQuantity(1)} aria-label={`Ajouter une unité de ${product.product_name}`}>+</button></div></td></tr>
}

function ProductPreview({ data }: { data: OffProduct }) {
  const grade = (data.nutriscore_grade || data.nutrition_grades || '').toLowerCase()
  return <div className="preview-card">{data.image_front_small_url ? <img src={data.image_front_small_url} alt="" /> : <div className="product-placeholder">✳</div>}<div className="preview-info"><strong>{data.product_name || 'Produit sans nom'}</strong><span>{[data.brands, data.quantity].filter(Boolean).join(' · ') || 'Informations complémentaires indisponibles'}</span></div>{grade && /^[a-e]$/.test(grade) && <span className={`score-badge grade-${grade}`}><strong>{grade.toUpperCase()}</strong><span>{gradeLabels[grade]}</span></span>}</div>
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return <div className="empty-state"><div className="empty-illustration"><span>✳</span><span>▦</span><span>●</span></div><span className="eyebrow">C’EST LE DÉBUT</span><h3>Votre liste n’attend que vous.</h3><p>Scannez le code-barres d’un produit pour voir ses informations nutritionnelles et l’ajouter à votre espace partagé.</p><button className="button button-primary" onClick={onScan}>Scanner le premier produit <span>↗</span></button></div>
}

function SetupScreen() {
  return <main className="setup-page"><div className="setup-card"><Brand /><span className="eyebrow">CONFIGURATION REQUISE</span><h1>Connectez votre espace partagé.</h1><p>Ajoutez l’URL de votre projet Supabase et sa clé publique anon dans un fichier <code>.env.local</code> à la racine du projet, puis redémarrez le site.</p><pre>VITE_SUPABASE_URL=https://votre-projet.supabase.co<br />VITE_SUPABASE_ANON_KEY=votre-cle-anon</pre><p>Les instructions complètes sont dans le fichier README du projet. Ne collez jamais une clé secrète Supabase dans le site.</p></div></main>
}

export default App
