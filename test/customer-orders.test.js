import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function getAvailablePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child, url, output) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited early: ${output.join('')}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Test server did not start: ${output.join('')}`);
}

async function apiRequest(baseUrl, route, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  const setCookie = response.headers.get('set-cookie') || '';
  const token = setCookie.match(/(?:^|,\s*)token=([^;]+)/)?.[1];
  return { response, data, cookie: token ? `token=${token}` : cookie };
}

test('customers can view and cancel their pending orders, but not other customers’ orders', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'freshcart-customer-orders-'));
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const server = spawn(process.execPath, [path.resolve('server/index.js')], {
    cwd: tempDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: 'isolated-integration-test-secret',
      SUPER_ADMIN_EMAIL: 'admin@example.test',
      SUPER_ADMIN_PASSWORD: 'integration-test-admin-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => output.push(chunk.toString()));
  server.stderr.on('data', (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    if (server.exitCode === null) {
      server.kill();
      await Promise.race([
        once(server, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  await waitForServer(server, baseUrl, output);

  const unauthenticatedOrder = await apiRequest(baseUrl, '/orders', {
    method: 'POST',
    body: { shopSlug: 'test-shop', items: [], deliveryAddress: 'Test address' },
  });
  assert.equal(unauthenticatedOrder.response.status, 401);

  const adminLogin = await apiRequest(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email: 'admin@example.test', password: 'integration-test-admin-password' },
  });
  assert.equal(adminLogin.response.status, 200);

  const shopResponse = await apiRequest(baseUrl, '/admin/shops', {
    method: 'POST',
    cookie: adminLogin.cookie,
    body: {
      name: 'Test Grocery',
      slug: 'test-grocery',
      owners: [
        { name: 'Owner One', email: 'owner-one@example.test', password: 'owner-one-password', phone: '+911111111111' },
        { name: 'Owner Two', email: 'owner-two@example.test', password: 'owner-two-password', phone: '+922222222222' },
      ],
      deliveryCharges: 25.5,
      minimumOrder: 0,
    },
  });
  assert.equal(shopResponse.response.status, 201);

  const ownerLogin = await apiRequest(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email: 'owner-two@example.test', password: 'owner-two-password' },
  });
  assert.equal(ownerLogin.response.status, 200);

  const productResponse = await apiRequest(baseUrl, '/products', {
    method: 'POST',
    cookie: ownerLogin.cookie,
    body: { name: 'Test Apples', price: 10, stock: 5, unit: 'piece' },
  });
  assert.equal(productResponse.response.status, 201);

  const customerLogin = await apiRequest(baseUrl, '/auth/register', {
    method: 'POST',
    body: {
      name: 'Customer One',
      email: 'customer-one@example.test',
      phone: '+913333333333',
      password: 'customer-one-password',
    },
  });
  assert.equal(customerLogin.response.status, 201);

  const firstOrder = await apiRequest(baseUrl, '/orders', {
    method: 'POST',
    cookie: customerLogin.cookie,
    body: {
      shopSlug: 'test-grocery',
      items: [{ productId: productResponse.data.productId, quantity: 2 }],
      deliveryAddress: '1 Test Street, Test Landmark',
      customerPhone: '+913333333333',
      paymentMethod: 'cash_on_delivery',
    },
  });
  assert.equal(firstOrder.response.status, 201);
  assert.equal(firstOrder.data.itemsSubtotal, 20);
  assert.equal(firstOrder.data.deliveryCharge, 25.5);
  assert.equal(firstOrder.data.total, 45.5);

  const history = await apiRequest(baseUrl, '/customer/orders', { cookie: customerLogin.cookie });
  assert.equal(history.response.status, 200);
  assert.equal(history.data.orders.length, 1);
  assert.equal(history.data.orders[0].items[0].product_name, 'Test Apples');
  assert.equal(history.data.orders[0].delivery_address, '1 Test Street, Test Landmark');
  assert.equal(history.data.orders[0].customer_phone, '+913333333333');
  assert.equal(history.data.orders[0].delivery_charge, 25.5);
  assert.equal(history.data.orders[0].status, 'pending');
  const ownerOrderList = await apiRequest(baseUrl, '/orders', { cookie: ownerLogin.cookie });
  assert.equal(ownerOrderList.data.orders[0].customer_phone, '+913333333333');

  const otherCustomer = await apiRequest(baseUrl, '/auth/register', {
    method: 'POST',
    body: {
      name: 'Customer Two',
      email: 'customer-two@example.test',
      phone: '+914444444444',
      password: 'customer-two-password',
    },
  });
  assert.equal(otherCustomer.response.status, 201);
  const forbiddenCancel = await apiRequest(baseUrl, `/customer/orders/${firstOrder.data.orderId}/cancel`, {
    method: 'POST',
    cookie: otherCustomer.cookie,
  });
  assert.equal(forbiddenCancel.response.status, 404);

  const cancel = await apiRequest(baseUrl, `/customer/orders/${firstOrder.data.orderId}/cancel`, {
    method: 'POST',
    cookie: customerLogin.cookie,
  });
  assert.equal(cancel.response.status, 200);

  const stockAfterCancel = await apiRequest(baseUrl, '/products', { cookie: ownerLogin.cookie });
  assert.equal(stockAfterCancel.data.products[0].stock, 5);

  const secondOrder = await apiRequest(baseUrl, '/orders', {
    method: 'POST',
    cookie: customerLogin.cookie,
    body: {
      shopSlug: 'test-grocery',
      items: [{ productId: productResponse.data.productId, quantity: 1 }],
      deliveryAddress: '1 Test Street, Test Landmark',
      customerPhone: '+913333333333',
      paymentMethod: 'cash_on_delivery',
    },
  });
  assert.equal(secondOrder.response.status, 201);
  assert.equal(secondOrder.data.total, 35.5);
  const processing = await apiRequest(baseUrl, `/orders/${secondOrder.data.orderId}/status`, {
    method: 'PATCH',
    cookie: ownerLogin.cookie,
    body: { status: 'processing' },
  });
  assert.equal(processing.response.status, 200);

  const lateCancel = await apiRequest(baseUrl, `/customer/orders/${secondOrder.data.orderId}/cancel`, {
    method: 'POST',
    cookie: customerLogin.cookie,
  });
  assert.equal(lateCancel.response.status, 409);

  const finalHistory = await apiRequest(baseUrl, '/customer/orders', { cookie: customerLogin.cookie });
  assert.deepEqual(finalHistory.data.orders.map((order) => order.status), ['processing', 'cancelled']);
  const finalStock = await apiRequest(baseUrl, '/products', { cookie: ownerLogin.cookie });
  assert.equal(finalStock.data.products[0].stock, 4);
});
