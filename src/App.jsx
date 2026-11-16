import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const API = '/api';
const DEFAULT_SEO_IMAGE = 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80';
const ORDER_STATUSES = ['pending', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'];

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function getProductUnit(product) {
  return ['kg', 'liter'].includes(product?.unit) ? product.unit : 'piece';
}

function formatQuantity(value) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatOrderDateTime(value) {
  const timestamp = String(value || '');
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)
    ? timestamp
    : `${timestamp.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return timestamp;

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

function PasswordInput({ value, onChange, ...inputProps }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        {...inputProps}
        type={isVisible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className="password-visibility"
        aria-label={isVisible ? 'Hide password' : 'Show password'}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
      >
        {isVisible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

function getSeoImageUrl(image) {
  if (typeof image === 'string' && /^https?:\/\//i.test(image)) return image;
  if (typeof image === 'string' && image.startsWith('/')) return `${window.location.origin}${image}`;
  return DEFAULT_SEO_IMAGE;
}

function Seo({ title, description, image = DEFAULT_SEO_IMAGE, noIndex = false, structuredData = null }) {
  const location = useLocation();

  useEffect(() => {
    const canonical = `${window.location.origin}${location.pathname}`;
    document.title = title;

    const updateMeta = (selector, attribute, value) => {
      let tag = document.querySelector(selector);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attribute, selector.includes('property=') ? selector.match(/property="([^"]+)"/)[1] : selector.match(/name="([^"]+)"/)[1]);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', value);
    };

    updateMeta('meta[name="description"]', 'name', description);
    updateMeta('meta[name="robots"]', 'name', noIndex ? 'noindex, nofollow' : 'index, follow');
    updateMeta('meta[property="og:title"]', 'property', title);
    updateMeta('meta[property="og:description"]', 'property', description);
    updateMeta('meta[property="og:url"]', 'property', canonical);
    updateMeta('meta[property="og:image"]', 'property', image);
    updateMeta('meta[name="twitter:title"]', 'name', title);
    updateMeta('meta[name="twitter:description"]', 'name', description);
    updateMeta('meta[name="twitter:image"]', 'name', image);

    let canonicalTag = document.querySelector('link[rel="canonical"]');
    if (!canonicalTag) {
      canonicalTag = document.createElement('link');
      canonicalTag.rel = 'canonical';
      document.head.appendChild(canonicalTag);
    }
    canonicalTag.href = canonical;

    const jsonLdTag = document.getElementById('seo-jsonld');
    if (jsonLdTag) {
      jsonLdTag.textContent = structuredData ? JSON.stringify(structuredData).replace(/</g, '\\u003c') : '';
    }
  }, [title, description, image, noIndex, structuredData, location.pathname]);

  return null;
}

function Header() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    request('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  const logout = async () => {
    await request('/auth/logout', { method: 'POST' });
    setUser(null);
    window.location.href = '/';
  };

  return (
    <header className="topbar">
      <div className="brand-wrap">
        <Link to="/" className="brand">FreshCart</Link>
      </div>
      <nav className="nav">
        <Link to="/">Home</Link>
        {user?.role === 'customer' ? <Link to="/customer/orders">My orders</Link> : null}
        {user && user.role !== 'customer' ? <Link to="/admin">Manage store</Link> : null}
        {!user ? <Link to="/customer/login">Customer sign in</Link> : null}
        {!user ? <Link to="/login">Store/Admin sign in</Link> : null}
      </nav>
      {user ? (
        <div className="user-box">
          <span>{user.name}</span>
          <button onClick={logout} className="btn btn-secondary">Logout</button>
        </div>
      ) : (
        <Link to="/customer/login" className="btn btn-primary">Sign in</Link>
      )}
    </header>
  );
}

function LandingPage() {
  const [shops, setShops] = useState([]);
  const structuredData = useMemo(() => ({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'FreshCart',
    url: window.location.origin,
    description: 'Shop fresh groceries from neighborhood stores with FreshCart.',
  }), []);

  useEffect(() => {
    request('/public/shops')
      .then((data) => setShops(data.shops || []))
      .catch(() => setShops([]));
  }, []);

  return (
    <div className="page-shell">
      <Seo
        title="FreshCart | Buy Fresh Groceries Online"
        description="Shop fresh groceries from neighborhood stores with FreshCart. Browse local shops, compare products, and order for delivery."
        structuredData={structuredData}
      />
      <section className="hero">
        <div>
          <p className="eyebrow">Fresh groceries from local stores</p>
          <h1>Shop your neighborhood grocery stores online.</h1>
          <p>
            Browse products from local shops, place an order online, and let shop owners manage their
            products and orders in one place.
          </p>
          <div className="cta-row">
            <Link to="/login" className="btn btn-primary">Manage Store</Link>
            <a href="#stores" className="btn btn-secondary">Browse stores</a>
          </div>
        </div>
        <div className="hero-card">
          <div className="mini-stat">
            <strong>Shop local</strong>
            <span>Explore products from neighborhood stores.</span>
          </div>
          <div className="mini-stat">
            <strong>Order online</strong>
            <span>Share your contact and delivery details at checkout.</span>
          </div>
          <div className="mini-stat">
            <strong>Manage simply</strong>
            <span>Store owners can update products, stock, and orders.</span>
          </div>
        </div>
      </section>

      <section className="section-block" id="stores">
        <div className="section-head">
          <h2>Partner stores</h2>
        </div>
        <div className="shop-grid">
          {shops.map((shop) => (
            <div className="shop-card" key={shop.id}>
              <img src={shop.logo || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80'} alt={shop.name} />
              <div className="shop-card-body">
                <h3>{shop.name}</h3>
                <p>{shop.description}</p>
                <div className="meta-row">
                  <span>{shop.address}</span>
                  <span>{shop.phone}</span>
                </div>
                <Link to={`/shop/${shop.slug}`} className="btn btn-primary">View Store</Link>
              </div>
            </div>
          ))}
          {!shops.length ? <div className="empty-state">No stores are available right now.</div> : null}
        </div>
      </section>
    </div>
  );
}

function ShopPage() {
  const { slug } = useParams();
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [selectedQuantities, setSelectedQuantities] = useState({});
  const [cart, setCart] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('freshcart-cart') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    request(`/public/shops/${slug}/products`)
      .then((data) => {
        setShop(data.shop);
        setProducts(data.products || []);
      })
      .catch(() => {
        setShop(null);
        setProducts([]);
      });
  }, [slug]);

  useEffect(() => {
    localStorage.setItem('freshcart-cart', JSON.stringify(cart));
  }, [cart]);

  const addToCart = (product, quantity) => {
    setCart((current) => ({
      ...current,
      [product.id]: {
        ...(current[product.id] || {}),
        product,
        shopSlug: slug,
        quantity: Number(current[product.id]?.quantity || 0) + quantity,
      },
    }));
  };

  const totalItems = useMemo(
    () => Object.keys(cart).length,
    [cart]
  );
  const shopStructuredData = useMemo(() => {
    if (!shop) return null;
    return {
      '@context': 'https://schema.org',
      '@type': 'GroceryStore',
      name: shop.name,
      description: shop.description || `Shop fresh groceries from ${shop.name} on FreshCart.`,
      url: `${window.location.origin}/shop/${slug}`,
      image: getSeoImageUrl(shop.logo),
      telephone: shop.phone || undefined,
      address: {
        '@type': 'PostalAddress',
        streetAddress: shop.address || undefined,
        addressCountry: 'IN',
      },
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: `${shop.name} products`,
        itemListElement: products.slice(0, 20).map((product) => ({
          '@type': 'Offer',
          priceCurrency: 'INR',
          price: Number(product.discount_price > 0 ? product.discount_price : product.price),
          availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemOffered: {
            '@type': 'Product',
            name: product.name,
            description: product.description || undefined,
            image: getSeoImageUrl(product.image_url),
          },
        })),
      },
    };
  }, [shop, products, slug]);

  return (
    <div className="page-shell">
      <Seo
        title={shop ? `${shop.name} | Fresh Groceries Online | FreshCart` : 'Shop | FreshCart'}
        description={shop?.description || 'Browse fresh groceries from your neighborhood store on FreshCart.'}
        image={getSeoImageUrl(shop?.logo)}
        noIndex={!shop}
        structuredData={shopStructuredData}
      />
      {shop ? (
        <>
          <section className="shop-hero">
            <div>
              <p className="eyebrow">Welcome to</p>
              <h1>{shop.name}</h1>
              <p>{shop.description}</p>
              <div className="meta-row">
                <span>{shop.address}</span>
                <span>{shop.phone}</span>
              </div>
            </div>
            <div className="mini-cart">
              <strong>{totalItems}</strong>
              <span>products in cart</span>
              <Link to="/checkout" className="btn btn-primary">Checkout</Link>
            </div>
          </section>

          <section className="product-grid">
            {products.map((product) => (
              <article className="product-card" key={product.id}>
                <img src={product.image_url || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80'} alt={product.name} />
                <div className="product-body">
                  <div className="badge-row">
                    <span className="badge">{product.category_name}</span>
                    {product.is_featured ? <span className="badge accent">Featured</span> : null}
                  </div>
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>
                  <div className="price-row">
                    <strong>{formatCurrency(product.discount_price || product.price)} / {getProductUnit(product)}</strong>
                    {product.discount_price ? <span>{formatCurrency(product.price)} / {getProductUnit(product)}</span> : null}
                  </div>
                  <div className="stock-row">
                    <span>{formatQuantity(product.stock)} {getProductUnit(product)} available</span>
                    <label>
                      Quantity ({getProductUnit(product)})
                      <input
                        type="number"
                        min={getProductUnit(product) === 'piece' ? '1' : '0.01'}
                        max={product.stock}
                        step={getProductUnit(product) === 'piece' ? '1' : '0.01'}
                        value={selectedQuantities[product.id] ?? String(Math.min(1, Number(product.stock) || 1))}
                        onChange={(event) => setSelectedQuantities((current) => ({
                          ...current,
                          [product.id]: event.target.value,
                        }))}
                      />
                    </label>
                    <button
                      onClick={() => addToCart(product, Number(selectedQuantities[product.id] ?? Math.min(1, Number(product.stock) || 1)))}
                      className="btn btn-primary"
                      disabled={
                        !Number(selectedQuantities[product.id] ?? Math.min(1, Number(product.stock) || 1))
                        || Number(selectedQuantities[product.id] ?? Math.min(1, Number(product.stock) || 1)) >
                          Number(product.stock) - Number(cart[product.id]?.quantity || 0)
                      }
                    >
                      Add to cart
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      ) : (
        <div className="empty-state">This shop is unavailable right now.</div>
      )}
    </div>
  );
}

function CheckoutPage() {
  const [cart, setCart] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('freshcart-cart') || '{}');
    } catch {
      return {};
    }
  });
  const [slug] = useState(() => {
    try {
      const savedCart = JSON.parse(localStorage.getItem('freshcart-cart') || '{}');
      return Object.values(savedCart)[0]?.shopSlug || '';
    } catch {
      return '';
    }
  });
  const [account, setAccount] = useState(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [shop, setShop] = useState(null);
  const [shopLoading, setShopLoading] = useState(Boolean(slug));
  const [shopLoadError, setShopLoadError] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash_on_delivery');
  const [status, setStatus] = useState('');
  const [successfulOrder, setSuccessfulOrder] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    request('/auth/me')
      .then(({ user }) => {
        setAccount(user);
        if (user.role === 'customer') setCustomerPhone(user.phone || '');
      })
      .catch(() => setAccount(null))
      .finally(() => setAccountLoading(false));
  }, []);

  useEffect(() => {
    if (!slug) {
      setShopLoading(false);
      return undefined;
    }

    let cancelled = false;
    request(`/public/shops/${encodeURIComponent(slug)}`)
      .then(({ shop: currentShop }) => {
        if (!cancelled) setShop(currentShop);
      })
      .catch((error) => {
        if (!cancelled) setShopLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setShopLoading(false);
      });

    return () => { cancelled = true; };
  }, [slug]);

  const items = Object.values(cart);
  const subtotal = items.reduce((sum, item) => (
    sum + (item.product.discount_price || item.product.price) * Number(item.quantity || 0)
  ), 0);
  const deliveryCharge = Number(shop?.delivery_charges || 0);
  const total = Number((subtotal + deliveryCharge).toFixed(2));

  const updateCartQuantity = (productId, quantity) => {
    setCart((current) => ({
      ...current,
      [productId]: { ...current[productId], quantity },
    }));
  };

  const removeCartItem = (productId) => {
    setCart((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    if (!items.length || submitting || shopLoading || !shop || shopLoadError) return;
    setStatus('');

    const invalidQuantity = items.some((item) => {
      const quantity = Number(item.quantity);
      const unit = getProductUnit(item.product);
      return !Number.isFinite(quantity)
        || quantity <= 0
        || quantity > Number(item.product.stock)
        || (unit === 'piece' ? !Number.isInteger(quantity) : Math.abs(quantity * 100 - Math.round(quantity * 100)) >= 1e-8);
    });
    if (invalidQuantity) {
      setStatus('Check each quantity against the available stock and unit.');
      return;
    }

    setSubmitting(true);
    try {
      const order = await request('/orders', {
        method: 'POST',
        body: JSON.stringify({
          shopSlug: slug,
          items: items.map((item) => ({ productId: item.product.id, quantity: Number(item.quantity) })),
          customerPhone,
          deliveryAddress,
          paymentMethod,
        }),
      });
      setSuccessfulOrder({
        itemsSubtotal: order.itemsSubtotal,
        deliveryCharge: order.deliveryCharge,
        total: order.total,
      });
      localStorage.removeItem('freshcart-cart');
      setCart({});
    } catch (error) {
      setSuccessfulOrder(null);
      setStatus(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (accountLoading) {
    return <div className="page-shell narrow"><div className="panel">Checking your customer account…</div></div>;
  }

  if (!account || account.role !== 'customer') {
    return (
      <div className="page-shell narrow">
        <Seo title="Customer sign in | FreshCart" description="Sign in to place an order and view your order history." noIndex />
        <div className="panel">
          <h2>Sign in before checkout</h2>
          <p>Customer accounts keep your orders and delivery details together. Your cart will be saved while you sign in.</p>
          {account ? <p>Please use a customer account, not a store or admin account.</p> : null}
          <div className="cta-row">
            <Link className="btn btn-primary" to="/customer/login?redirect=%2Fcheckout">Customer sign in</Link>
            <Link className="btn btn-secondary" to="/customer/register?redirect=%2Fcheckout">Create customer account</Link>
          </div>
        </div>
      </div>
    );
  }

  if (successfulOrder) {
    return (
      <div className="page-shell narrow">
        <Seo
          title="Order confirmed | FreshCart"
          description="Thank you for ordering with FreshCart. Your order has been received."
          noIndex
        />
        <section className="panel order-success" role="status">
          <span className="status-badge live">Order confirmed</span>
          <h1>Thanks for bringing FreshCart to your table!</h1>
          <p>Your order is safely with the shop. They’ll review it and update its status soon.</p>
          <div className="summary-box">
            <p><strong>Items subtotal:</strong> {formatCurrency(successfulOrder.itemsSubtotal)}</p>
            <p><strong>Delivery charge:</strong> {formatCurrency(successfulOrder.deliveryCharge)}</p>
            <p><strong>Total:</strong> {formatCurrency(successfulOrder.total)}</p>
          </div>
          <div className="cta-row">
            <Link className="btn btn-primary" to="/customer/orders">Track my order</Link>
            <Link className="btn btn-secondary" to="/">Continue shopping</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page-shell narrow">
      <Seo
        title="Checkout | FreshCart"
        description="Review your grocery cart and arrange delivery from your local FreshCart store."
        noIndex
      />
      <form className="panel" onSubmit={submitOrder}>
        <h2>Checkout</h2>
        <p>Ordering as {account.name} ({account.email}).</p>
        <label>
          Phone
          <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} required autoComplete="tel" />
        </label>
        <label>
          Delivery address and landmark
          <textarea
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
            placeholder="House/flat, street, area, landmark, city and PIN code"
            required
            autoComplete="street-address"
          />
        </label>
        {shopLoadError ? <p className="status-banner" role="alert">Could not load delivery charges: {shopLoadError}</p> : null}
        <label>
          Payment method
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option value="cash_on_delivery">Cash on delivery</option>
          </select>
        </label>
        <div className="summary-box">
          {items.length ? (
            items.map((item) => (
              <div key={item.product.id} className="summary-row">
                <div>
                  <span>{item.product.name}</span>
                  <label>
                    Quantity ({getProductUnit(item.product)})
                    <input
                      type="number"
                      min={getProductUnit(item.product) === 'piece' ? '1' : '0.01'}
                      max={item.product.stock}
                      step={getProductUnit(item.product) === 'piece' ? '1' : '0.01'}
                      value={item.quantity}
                      onChange={(event) => updateCartQuantity(item.product.id, event.target.value)}
                    />
                  </label>
                  <button type="button" className="btn btn-secondary" onClick={() => removeCartItem(item.product.id)}>
                    Remove
                  </button>
                </div>
                <strong>{formatCurrency((item.product.discount_price || item.product.price) * Number(item.quantity || 0))}</strong>
              </div>
            ))
          ) : (
            <p>Your cart is empty.</p>
          )}
          <div className="summary-row">
            <span>Items subtotal</span>
            <strong>{formatCurrency(subtotal)}</strong>
          </div>
          <div className="summary-row">
            <span>Delivery charge{shop && deliveryCharge === 0 ? ' (Free)' : ''}</span>
            <strong>
              {shopLoading ? 'Loading…' : shopLoadError ? 'Unavailable' : formatCurrency(deliveryCharge)}
            </strong>
          </div>
          <div className="summary-row total-row">
            <span>Total</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={!items.length || submitting || shopLoading || !shop || Boolean(shopLoadError)}>
          {submitting ? 'Placing order…' : shopLoading ? 'Loading delivery charge…' : 'Place order'}
        </button>
        {status ? (
          <p className="status-banner" role="status">
            {status} <Link to="/customer/orders">View my orders</Link>
          </p>
        ) : null}
      </form>
    </div>
  );
}

function getCustomerRedirectTarget() {
  const requestedPath = new URLSearchParams(window.location.search).get('redirect');
  return ['/checkout', '/customer/orders'].includes(requestedPath) ? requestedPath : '/customer/orders';
}

function CustomerAuthPage({ mode }) {
  const isRegister = mode === 'register';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const redirectTarget = getCustomerRedirectTarget();

  const submit = async (event) => {
    event.preventDefault();
    setStatus('');
    setSubmitting(true);
    try {
      const data = await request(isRegister ? '/auth/register' : '/auth/customer/login', {
        method: 'POST',
        body: JSON.stringify(isRegister ? { name, email, phone, password } : { email, password }),
      });
      if (data.user.role !== 'customer') {
        throw new Error('Use the store or admin sign-in page for this account.');
      }
      window.location.href = redirectTarget;
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const alternateMode = isRegister ? 'login' : 'register';
  const alternatePath = `/customer/${alternateMode}?redirect=${encodeURIComponent(redirectTarget)}`;

  return (
    <div className="page-shell narrow">
      <Seo
        title={`${isRegister ? 'Create customer account' : 'Customer sign in'} | FreshCart`}
        description="Use a customer account to place grocery orders and view order history."
        noIndex
      />
      <form className="panel stack-form" onSubmit={submit}>
        <h2>{isRegister ? 'Create customer account' : 'Customer sign in'}</h2>
        <p>{isRegister ? 'Register once, then sign in with your email and password.' : 'Sign in to place orders and see their status and history.'}</p>
        {isRegister ? (
          <label>
            Your name
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </label>
        ) : null}
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        {isRegister ? (
          <label>
            Phone
            <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" required />
          </label>
        ) : null}
        <label>
          Password
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            required
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
        {status ? <p className="status-banner" role="alert">{status}</p> : null}
        <p>
          {isRegister ? 'Already have an account?' : 'First time ordering?'}{' '}
          <Link to={alternatePath}>{isRegister ? 'Sign in' : 'Create an account'}</Link>
        </p>
      </form>
    </div>
  );
}

function CustomerOrdersPage() {
  const [user, setUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [message, setMessage] = useState('');

  const loadOrders = async () => {
    setError('');
    try {
      const { user: currentUser } = await request('/auth/me');
      setUser(currentUser);
      if (currentUser.role !== 'customer') {
        setOrders([]);
        return;
      }
      const data = await request('/customer/orders');
      setOrders(data.orders || []);
    } catch (requestError) {
      setUser(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrders(); }, []);

  const cancelOrder = async (orderId) => {
    if (!window.confirm(`Cancel order #${orderId}?`)) return;
    setCancellingOrderId(orderId);
    setMessage('');
    setError('');
    try {
      const result = await request(`/customer/orders/${orderId}/cancel`, { method: 'POST' });
      setMessage(result.message);
      await loadOrders();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setCancellingOrderId(null);
    }
  };

  if (loading) {
    return <div className="page-shell"><div className="panel">Loading your orders…</div></div>;
  }

  if (!user || user.role !== 'customer') {
    return (
      <div className="page-shell narrow">
        <div className="panel">
          <h2>Customer sign in required</h2>
          <p>Sign in with your customer account to see your orders.</p>
          <div className="cta-row">
            <Link className="btn btn-primary" to="/customer/login?redirect=%2Fcustomer%2Forders">Sign in</Link>
            <Link className="btn btn-secondary" to="/customer/register?redirect=%2Fcustomer%2Forders">Create account</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell customer-orders">
      <Seo title="My orders | FreshCart" description="View your FreshCart order history and status." noIndex />
      <div className="toolbar">
        <div>
          <h1>My orders</h1>
          <p>Signed in as {user.email}</p>
        </div>
        <Link className="btn btn-primary" to="/">Browse stores</Link>
      </div>
      {message ? <p className="status-banner" role="status">{message}</p> : null}
      {error ? <p className="status-banner" role="alert">{error}</p> : null}
      {orders.length === 0 ? (
        <div className="panel empty-state">
          <p>You have not placed any orders yet.</p>
          <Link to="/">Browse stores</Link>
        </div>
      ) : (
        <div className="customer-order-list">
          {orders.map((order) => (
            <article className="panel customer-order" key={order.id}>
              <div className="toolbar">
                <div>
                  <h2>Order from {order.shop_name}</h2>
                  <p>{formatOrderDateTime(order.created_at)}</p>
                </div>
                <span className={`status-badge ${order.status === 'cancelled' ? 'inactive' : order.status === 'delivered' ? 'live' : ''}`}>
                  {order.status}
                </span>
              </div>
              <ul className="customer-order-items">
                {order.items.map((item) => (
                  <li key={`${order.id}-${item.product_id}`}>
                    <span>{item.product_name} × {formatQuantity(item.quantity)} {item.unit}</span>
                    <strong>{formatCurrency(item.subtotal)}</strong>
                  </li>
                ))}
              </ul>
              <p><strong>Items subtotal:</strong> {formatCurrency(order.items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0))}</p>
              <p><strong>Delivery charge:</strong> {formatCurrency(order.delivery_charge)}</p>
              <p><strong>Total:</strong> {formatCurrency(order.total_amount)}</p>
              <p><strong>Delivery to:</strong> {order.delivery_address}</p>
              {order.status === 'pending' ? (
                <button
                  type="button"
                  className="btn btn-secondary danger"
                  onClick={() => cancelOrder(order.id)}
                  disabled={cancellingOrderId === order.id}
                >
                  {cancellingOrderId === order.id ? 'Cancelling…' : 'Cancel order'}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    try {
      const data = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStatus('Login successful');
      window.location.href = data.user.role === 'super_admin'
        ? '/admin'
        : data.user.role === 'shop_owner'
          ? '/shop-admin'
          : '/customer/orders';
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <div className="page-shell narrow">
      <Seo
        title="Sign in | FreshCart"
        description="Sign in to manage your FreshCart shop or account."
        noIndex
      />
      <form className="panel" onSubmit={submit}>
        <h2>Login</h2>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary" type="submit">Continue</button>
        {status ? <p className="status-banner">{status}</p> : null}
        <div className="helper-box">
          Use the account credentials provided by your platform administrator or shop owner.
        </div>
      </form>
    </div>
  );
}

function DashboardPage() {
  const [user, setUser] = useState(null);
  const [summary, setSummary] = useState(null);
  const [orders, setOrders] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [products, setProducts] = useState([]);
  const [shops, setShops] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [socketStatus, setSocketStatus] = useState('Connecting...');
  const [activeTab, setActiveTab] = useState('overview');
  const [productForm, setProductForm] = useState({
    id: null,
    name: '',
    description: '',
    price: '0',
    discountPrice: '0',
    stock: '0',
    unit: 'piece',
    categoryId: '',
    sku: '',
    imageUrl: '',
    isFeatured: false,
    isActive: true,
  });
  const [productImage, setProductImage] = useState(null);
  const [productImagePreview, setProductImagePreview] = useState('');
  const [categoryForm, setCategoryForm] = useState({
    id: null,
    name: '',
    imageUrl: '',
  });
  const [shopFormOpen, setShopFormOpen] = useState(false);
  const [shopFormStatus, setShopFormStatus] = useState('');
  const [adminCredentials, setAdminCredentials] = useState({
    email: '',
    currentPassword: '',
    newPassword: '',
  });
  const [adminCredentialsStatus, setAdminCredentialsStatus] = useState('');
  const [shopForm, setShopForm] = useState({
    name: '',
    slug: '',
    description: '',
    address: '',
    deliveryCharges: '0',
    minimumOrder: '0',
    owners: [{ name: '', email: '', password: '', phone: '' }],
  });

  const fetchDashboard = async () => {
    try {
      const me = await request('/auth/me');
      setUser(me.user);
      if (me.user.role === 'super_admin') {
        setAdminCredentials((current) => current.email ? current : { ...current, email: me.user.email });
      }

      const dash = await request('/dashboard/summary');
      const orderData = await request('/orders');
      const notifyData = await request('/notifications');
      setSummary(dash);
      setOrders(orderData.orders || []);
      setNotifications(notifyData.notifications || []);

      if (me.user.role === 'super_admin') {
        const shopData = await request('/admin/shops');
        setShops(shopData.shops || []);
      } else {
        const productData = await request('/products');
        setProducts(productData.products || []);
        const categoryData = await request('/categories');
        setCategories(categoryData.categories || []);
      }
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  useEffect(() => {
    fetchDashboard();

    const socket = io('http://localhost:4000', { withCredentials: true });
    socket.on('connect', () => setSocketStatus('Live connection active'));
    socket.on('notification', (event) => {
      setNotifications((current) => [event, ...current].slice(0, 10));
    });

    return () => socket.disconnect();
  }, []);

  const resetProductForm = () => {
    setProductForm({
      id: null,
      name: '',
      description: '',
      price: '0',
      discountPrice: '0',
      stock: '0',
      unit: 'piece',
      categoryId: '',
      sku: '',
      imageUrl: '',
      isFeatured: false,
      isActive: true,
    });
    if (productImagePreview.startsWith('blob:')) URL.revokeObjectURL(productImagePreview);
    setProductImage(null);
    setProductImagePreview('');
  };

  const resetCategoryForm = () => {
    setCategoryForm({ id: null, name: '', imageUrl: '' });
  };

  const handleShopSubmit = async (event) => {
    event.preventDefault();
    setShopFormStatus('');
    try {
      await request('/admin/shops', {
        method: 'POST',
        body: JSON.stringify(shopForm),
      });
      setShopForm({
        name: '',
        slug: '',
        description: '',
        address: '',
        deliveryCharges: '0',
        minimumOrder: '0',
        owners: [{ name: '', email: '', password: '', phone: '' }],
      });
      setShopFormOpen(false);
      setShopFormStatus('Shop and owner accounts created.');
      await fetchDashboard();
    } catch (error) {
      setShopFormStatus(error.message);
    }
  };

  const handleAdminCredentialsSubmit = async (event) => {
    event.preventDefault();
    setAdminCredentialsStatus('');
    try {
      const data = await request('/auth/credentials', {
        method: 'PATCH',
        body: JSON.stringify(adminCredentials),
      });
      setUser(data.user);
      setAdminCredentials({ email: data.user.email, currentPassword: '', newPassword: '' });
      setAdminCredentialsStatus('Admin login credentials updated.');
    } catch (error) {
      setAdminCredentialsStatus(error.message);
    }
  };

  const handleProductSubmit = async (event) => {
    event.preventDefault();
    try {
      let imageUrl = productForm.imageUrl;
      if (productImage) {
        const formData = new FormData();
        formData.append('image', productImage);
        const uploadedImage = await request('/products/upload-image', {
          method: 'POST',
          body: formData,
        });
        imageUrl = uploadedImage.imageUrl;
        if (productImagePreview.startsWith('blob:')) URL.revokeObjectURL(productImagePreview);
        setProductImage(null);
        setProductImagePreview(imageUrl);
        setProductForm((current) => ({ ...current, imageUrl }));
      }

      const payload = {
        name: productForm.name,
        description: productForm.description,
        price: Number(productForm.price),
        discountPrice: Number(productForm.discountPrice),
        stock: Number(productForm.stock),
        unit: productForm.unit,
        categoryId: productForm.categoryId || null,
        sku: productForm.sku || '',
        imageUrl,
        isFeatured: productForm.isFeatured,
        isActive: productForm.isActive,
      };

      if (productForm.id) {
        await request(`/products/${productForm.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await request('/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      resetProductForm();
      fetchDashboard();
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  const handleCategorySubmit = async (event) => {
    event.preventDefault();
    try {
      if (categoryForm.id) {
        await request(`/categories/${categoryForm.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: categoryForm.name,
            imageUrl: categoryForm.imageUrl,
          }),
        });
      } else {
        await request('/categories', {
          method: 'POST',
          body: JSON.stringify({
            name: categoryForm.name,
            imageUrl: categoryForm.imageUrl,
          }),
        });
      }

      resetCategoryForm();
      fetchDashboard();
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  const loadProductForEdit = (product) => {
    setProductForm({
      id: product.id,
      name: product.name,
      description: product.description || '',
      price: String(product.price),
      discountPrice: String(product.discount_price || 0),
      stock: String(product.stock || 0),
      unit: ['kg', 'liter'].includes(product.unit) ? product.unit : 'piece',
      categoryId: product.category_id || '',
      sku: product.sku || '',
      imageUrl: product.image_url || '',
      isFeatured: Boolean(product.is_featured),
      isActive: Boolean(product.is_active),
    });
    if (productImagePreview.startsWith('blob:')) URL.revokeObjectURL(productImagePreview);
    setProductImage(null);
    setProductImagePreview(product.image_url || '');
    setActiveTab('products');
  };

  const deleteProduct = async (productId) => {
    try {
      await request(`/products/${productId}`, { method: 'DELETE' });
      fetchDashboard();
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  const loadCategoryForEdit = (category) => {
    setCategoryForm({ id: category.id, name: category.name, imageUrl: category.image_url || '' });
  };

  const deleteCategory = async (categoryId) => {
    try {
      await request(`/categories/${categoryId}`, { method: 'DELETE' });
      fetchDashboard();
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  const toggleShopStatus = async (shop) => {
    try {
      await request(`/admin/shops/${shop.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !shop.is_active }),
      });
      await fetchDashboard();
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  const viewOrderDetails = async (orderId) => {
    try {
      const details = await request(`/orders/${orderId}`);
      setSelectedOrder(details.order);
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  const updateOrderStatus = async (orderId, nextStatus) => {
    try {
      await request(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      fetchDashboard();
      if (selectedOrder && selectedOrder.id === orderId) {
        viewOrderDetails(orderId);
      }
    } catch (error) {
      setSocketStatus(error.message);
    }
  };

  if (!summary || !user) {
    return <div className="page-shell"><div className="empty-state">Loading dashboard…</div></div>;
  }

  const tabs = user.role === 'super_admin'
    ? ['overview', 'shops', 'orders', 'settings']
    : ['overview', 'products', 'orders'];

  return (
    <div className="page-shell dashboard-shell">
      <Seo
        title={`${user.role === 'super_admin' ? 'Platform admin' : 'Shop management'} | FreshCart`}
        description="Manage FreshCart shop operations, products, inventory and orders."
        noIndex
      />
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">FreshCart operations</p>
          <h1>{user.role === 'super_admin' ? 'Platform admin dashboard' : 'Shop management dashboard'}</h1>
        </div>
        <div className="status-pill">{socketStatus}</div>
      </section>

      <div className="dashboard-tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="stats-grid">
            {Object.entries(summary.totals || {}).map(([label, value]) => (
              <div className="stat-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <div className="two-column">
            <div className="panel">
              <h3>Recent orders</h3>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} onClick={() => viewOrderDetails(order.id)} className="clickable-row">
                      <td>#{order.id}</td>
                      <td>{order.status}</td>
                      <td>{formatCurrency(order.total_amount || order.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel">
              <h3>Notifications</h3>
              <ul className="notification-list">
                {notifications.map((notification, index) => (
                  <li key={`${notification.id || index}`}>
                    <span>{notification.type}</span>
                    <p>{notification.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      {user.role === 'super_admin' && activeTab === 'shops' && (
        <div className="panel">
          <div className="toolbar">
            <h3>Registered shops</h3>
            <button className="btn btn-primary" onClick={() => {
              setShopFormStatus('');
              setShopFormOpen((isOpen) => !isOpen);
            }}>
              {shopFormOpen ? 'Close form' : 'Add shop'}
            </button>
          </div>
          <p>Deactivate hides a shop from customers but keeps its data and order history.</p>
          {shopFormOpen && (
            <form className="stack-form" onSubmit={handleShopSubmit}>
              <div className="form-grid">
                <label>
                  Shop name
                  <input
                    value={shopForm.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      setShopForm((current) => ({
                        ...current,
                        name,
                        slug: name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                      }));
                    }}
                    required
                  />
                </label>
                <label>
                  Shop URL slug
                  <input
                    value={shopForm.slug}
                    onChange={(event) => setShopForm({ ...shopForm, slug: event.target.value })}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    required
                  />
                </label>
                <label>
                  Delivery charges
                  <input type="number" min="0" step="0.01" value={shopForm.deliveryCharges} onChange={(event) => setShopForm({ ...shopForm, deliveryCharges: event.target.value })} />
                </label>
                <label>
                  Minimum order
                  <input type="number" min="0" step="0.01" value={shopForm.minimumOrder} onChange={(event) => setShopForm({ ...shopForm, minimumOrder: event.target.value })} />
                </label>
              </div>
              <section className="panel">
                <h3>Owner accounts</h3>
                {shopForm.owners.map((owner, index) => (
                  <div className="form-grid" key={index}>
                    <label>
                      Owner {index + 1} name
                      <input
                        value={owner.name}
                        onChange={(event) => setShopForm((current) => ({
                          ...current,
                          owners: current.owners.map((item, itemIndex) => itemIndex === index
                            ? { ...item, name: event.target.value }
                            : item),
                        }))}
                        required
                      />
                    </label>
                    <label>
                      Owner {index + 1} login email
                      <input
                        type="email"
                        value={owner.email}
                        onChange={(event) => setShopForm((current) => ({
                          ...current,
                          owners: current.owners.map((item, itemIndex) => itemIndex === index
                            ? { ...item, email: event.target.value }
                            : item),
                        }))}
                        required
                      />
                    </label>
                    <label>
                      Owner {index + 1} login password
                      <PasswordInput
                        value={owner.password}
                        onChange={(event) => setShopForm((current) => ({
                          ...current,
                          owners: current.owners.map((item, itemIndex) => itemIndex === index
                            ? { ...item, password: event.target.value }
                            : item),
                        }))}
                        minLength={8}
                        required
                      />
                    </label>
                    <label>
                      Owner {index + 1} phone
                      <input
                        type="tel"
                        value={owner.phone}
                        onChange={(event) => setShopForm((current) => ({
                          ...current,
                          owners: current.owners.map((item, itemIndex) => itemIndex === index
                            ? { ...item, phone: event.target.value }
                            : item),
                        }))}
                        required
                      />
                    </label>
                    {shopForm.owners.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setShopForm((current) => ({
                          ...current,
                          owners: current.owners.filter((_, itemIndex) => itemIndex !== index),
                        }))}
                      >
                        Remove owner
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShopForm((current) => ({
                    ...current,
                    owners: [...current.owners, { name: '', email: '', password: '', phone: '' }],
                  }))}
                >
                  Add another owner
                </button>
              </section>
              <label>
                Shop address
                <input value={shopForm.address} onChange={(event) => setShopForm({ ...shopForm, address: event.target.value })} />
              </label>
              <label>
                Description
                <textarea value={shopForm.description} onChange={(event) => setShopForm({ ...shopForm, description: event.target.value })} />
              </label>
              <div className="button-row">
                <button className="btn btn-primary" type="submit">Create shop</button>
              </div>
            </form>
          )}
          {shopFormStatus ? <p className="status-banner">{shopFormStatus}</p> : null}
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => (
                <tr key={shop.id}>
                  <td>{shop.name}</td>
                  <td>{shop.slug}</td>
                  <td>{shop.phone}</td>
                  <td>{shop.is_active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => toggleShopStatus(shop)}>
                      {shop.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {user.role === 'super_admin' && activeTab === 'settings' && (
        <div className="panel narrow">
          <h3>Admin security</h3>
          <p>Change the admin email and password. Your current password is required to confirm the update.</p>
          <form className="stack-form" onSubmit={handleAdminCredentialsSubmit}>
            <label>
              Admin email
              <input
                type="email"
                autoComplete="username"
                value={adminCredentials.email}
                onChange={(event) => setAdminCredentials({ ...adminCredentials, email: event.target.value })}
                required
              />
            </label>
            <label>
              Current password
              <PasswordInput
                autoComplete="current-password"
                value={adminCredentials.currentPassword}
                onChange={(event) => setAdminCredentials({ ...adminCredentials, currentPassword: event.target.value })}
                required
              />
            </label>
            <label>
              New password (at least 12 characters)
              <PasswordInput
                autoComplete="new-password"
                minLength={12}
                value={adminCredentials.newPassword}
                onChange={(event) => setAdminCredentials({ ...adminCredentials, newPassword: event.target.value })}
                required
              />
            </label>
            <button className="btn btn-primary" type="submit">Update admin login</button>
            {adminCredentialsStatus ? <p className="status-banner">{adminCredentialsStatus}</p> : null}
          </form>
        </div>
      )}

      {user.role === 'shop_owner' && activeTab === 'products' && (
        <div className="two-column">
          <div className="panel">
            <h3>{productForm.id ? 'Edit product' : 'Add product'}</h3>
            <form onSubmit={handleProductSubmit} className="stack-form">
              <div className="form-grid">
                <label>
                  Product name
                  <input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
                </label>
                <label>
                  Selling unit
                  <select value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}>
                    <option value="piece">Piece</option>
                    <option value="kg">Kilogram (kg)</option>
                    <option value="liter">Liter (L)</option>
                  </select>
                </label>
                <label>
                  Price per {productForm.unit === 'piece' ? 'piece' : productForm.unit}
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Discount
                  <input type="number" min="0" step="0.01" value={productForm.discountPrice} onChange={(e) => setProductForm({ ...productForm, discountPrice: e.target.value })} />
                </label>
                <label>
                  Stock ({productForm.unit === 'piece' ? 'pieces' : productForm.unit})
                  <input
                    type="number"
                    min="0"
                    step={productForm.unit === 'piece' ? '1' : '0.01'}
                    value={productForm.stock}
                    onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                  />
                </label>
                <label>
                  Category
                  <select value={productForm.categoryId} onChange={(e) => setProductForm({ ...productForm, categoryId: e.target.value })}>
                    <option value="">Select category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  SKU
                  <input value={productForm.sku || ''} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} />
                </label>
                <label>
                  Product image
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      if (productImagePreview.startsWith('blob:')) URL.revokeObjectURL(productImagePreview);
                      setProductImage(file);
                      setProductImagePreview(file ? URL.createObjectURL(file) : productForm.imageUrl);
                    }}
                  />
                  <small>JPG, PNG or WebP; maximum 5 MB.</small>
                </label>
                <label>
                  Featured?
                  <input type="checkbox" checked={productForm.isFeatured} onChange={(e) => setProductForm({ ...productForm, isFeatured: e.target.checked })} />
                </label>
              </div>
              {productImagePreview ? (
                <div className="image-upload-preview">
                  <img className="image-preview" src={productImagePreview} alt="Product preview" />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      if (productImagePreview.startsWith('blob:')) URL.revokeObjectURL(productImagePreview);
                      setProductImage(null);
                      setProductImagePreview('');
                      setProductForm({ ...productForm, imageUrl: '' });
                    }}
                  >
                    Remove image
                  </button>
                </div>
              ) : null}
              <label>
                Description
                <textarea value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} />
              </label>
              <div className="button-row">
                <button className="btn btn-primary" type="submit">{productForm.id ? 'Update product' : 'Save product'}</button>
                {productForm.id ? <button type="button" className="btn btn-secondary" onClick={resetProductForm}>Cancel</button> : null}
              </div>
            </form>

            <div className="panel section-panel">
              <h3>{categoryForm.id ? 'Edit category' : 'Add category'}</h3>
              <form onSubmit={handleCategorySubmit} className="stack-form">
                <label>
                  Category name
                  <input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} />
                </label>
                <label>
                  Category image URL
                  <input value={categoryForm.imageUrl} onChange={(e) => setCategoryForm({ ...categoryForm, imageUrl: e.target.value })} />
                </label>
                <div className="button-row">
                  <button className="btn btn-primary" type="submit">{categoryForm.id ? 'Update category' : 'Save category'}</button>
                  {categoryForm.id ? <button type="button" className="btn btn-secondary" onClick={resetCategoryForm}>Cancel</button> : null}
                </div>
              </form>
            </div>
          </div>

          <div className="panel">
            <h3>Catalog</h3>
            <div className="manager-list">
              {products.map((product) => (
                <div key={product.id} className="manager-item">
                  <div>
                    <strong>{product.name}</strong>
                    <p>{formatQuantity(product.stock)} {getProductUnit(product)} in stock · {formatCurrency(product.discount_price || product.price)} / {getProductUnit(product)} · {product.category_name || 'General'}</p>
                  </div>
                  <div className="row-actions">
                    <span className={`status-badge ${product.is_active ? 'live' : 'inactive'}`}>
                      {product.is_active ? 'Active' : 'Disabled'}
                    </span>
                    <button className="btn btn-secondary" onClick={() => loadProductForEdit(product)}>Edit</button>
                    <button className="btn btn-secondary danger" onClick={() => deleteProduct(product.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="manager-list category-list">
              {categories.map((category) => (
                <div key={category.id} className="manager-item">
                  <div>
                    <strong>{category.name}</strong>
                    <p>{category.slug}</p>
                  </div>
                  <div className="row-actions">
                    <button className="btn btn-secondary" onClick={() => loadCategoryForEdit(category)}>Edit</button>
                    <button className="btn btn-secondary danger" onClick={() => deleteCategory(category.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {(user.role === 'super_admin' || user.role === 'shop_owner') && activeTab === 'orders' && (
        <div className="panel">
          <h3>Order management</h3>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Customer</th>
                <th>Customer phone</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>#{order.id}</td>
                  <td>{order.customer_name || 'Guest'}</td>
                  <td>
                    {order.customer_phone ? (
                      <a href={`tel:${order.customer_phone.replace(/[^\d+]/g, '')}`}>{order.customer_phone}</a>
                    ) : '—'}
                  </td>
                  <td>{formatCurrency(order.total_amount)}</td>
                  <td>
                    <select
                      value={order.status}
                      onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                      className="inline-select"
                    >
                      {ORDER_STATUSES.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => viewOrderDetails(order.id)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedOrder ? (
            <div className="detail-card">
              <h4>Order #{selectedOrder.id}</h4>
              <p><strong>Customer:</strong> {selectedOrder.customer_name}</p>
              <p>
                <strong>Customer phone:</strong>{' '}
                {selectedOrder.customer_phone ? (
                  <a href={`tel:${selectedOrder.customer_phone.replace(/[^\d+]/g, '')}`}>
                    {selectedOrder.customer_phone}
                  </a>
                ) : 'Not provided'}
              </p>
              <p><strong>Address:</strong> {selectedOrder.delivery_address}</p>
              <p><strong>Payment:</strong> {selectedOrder.payment_method}</p>
              <p><strong>Total:</strong> {formatCurrency(selectedOrder.total_amount)}</p>
              <ul>
                {(selectedOrder.items || []).map((item) => (
                  <li key={item.id}>{item.product_name} × {formatQuantity(item.quantity)} {item.unit || 'piece'} = {formatCurrency(item.subtotal)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/shop/:slug" element={<ShopPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/customer/login" element={<CustomerAuthPage mode="login" />} />
      <Route path="/customer/register" element={<CustomerAuthPage mode="register" />} />
      <Route path="/customer/orders" element={<CustomerOrdersPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<DashboardPage />} />
      <Route path="/shop-admin" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <AppRoutes />
    </>
  );
}
