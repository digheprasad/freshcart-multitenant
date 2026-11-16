# FreshCart Multi-Tenant Grocery SaaS

FreshCart is a multi-tenant grocery e-commerce platform for multiple shop owners, with separate admin dashboards and tenant-scoped product and order management.

## Features

- Super admin dashboard with platform analytics
- Super admin can deactivate or reactivate shops without deleting their data
- Each shop can have multiple owner accounts, all with access to the shop dashboard
- Shop owner dashboard for products, categories, orders, inventory and settings
- Customer accounts with email/password sign-in, order history, product details and status tracking
- Customers can cancel an order while it is still pending
- Checkout requires a customer account, phone number and delivery address with a landmark
- Shop owners can view and call the customer using the phone number on an order
- Checkout shows the shop's delivery charge separately and includes it in the final total
- Products support g, mg, kg, L, ml, piece, dozen, packet, box, bottle, pouch, bundle, pair, set, pack, carton, tray, roll, and meter units; measured units allow fractional quantities up to two decimal places while counted units must be whole numbers
- Customer storefront for browsing and placing orders
- Shop owners can upload JPG, PNG, or WebP product images (up to 5 MB)
- Shop owners can upload category images, and customers can browse products by category
- SEO metadata, social sharing tags, structured store/product data, and an active-shop sitemap
- Secure authentication and JWT-based session handling
- SQLite-backed tenant-aware data layer
- Realtime dashboard notifications with Socket.IO
- Email and WhatsApp notification hooks
- Stronger backend validation and request rate limiting

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `SUPER_ADMIN_EMAIL` and a unique `SUPER_ADMIN_PASSWORD` of at least 12 characters before starting a new database.
3. Install dependencies:
   npm install
4. Start the API and frontend in development mode:
   npm run dev
5. Or run the production server:
   npm run build
   npm run start

The configured super admin is created only when the database has no super-admin account. Fresh installs do not create sample shops, products, or customer accounts. Existing database records are preserved. A signed-in super admin can update the admin email and password from **Admin → Settings**; the current password is required and the new password must be at least 12 characters.

The app runs at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:4000

The dev and production servers bind to all network interfaces. To open the site on a phone or another laptop on the same Wi-Fi, find this computer's IPv4 address with `ipconfig` and open `http://<IPv4-address>:4000` on that device. Allow Node.js through the computer's firewall if prompted. Public internet access requires deploying the app behind HTTPS.

Set `SITE_URL` to the canonical HTTPS domain before production deployment. The sitemap and canonical tags use this value.

Uploaded product images are stored locally under `uploads/products/<shopId>` and served from the app.

## Environment variables

Set a unique `JWT_SECRET` and a public HTTPS `SITE_URL` for production. Configure the `SUPER_ADMIN_*` values before the first start of a new database. Update email or WhatsApp variables only if those notifications are enabled.

## Security notes

Admin and shop-owner roles are not available through public customer registration. Environment secrets are not committed to the repo. Production deployments should use HTTPS and review hosting, reverse proxy, database backup, and secret management settings.
