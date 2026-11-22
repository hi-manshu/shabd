/**
 * "Try it" on an API page: the request is sent from the browser, and the
 * answer is shown.
 *
 * The API of the fixture does not exist. Each test answers in its place, and
 * keeps what the page sent.
 */
import type { Page, Request } from '@playwright/test'
import { BUILT, expect, open, test } from './support/fixtures.js'

const API = 'https://api.fixture.test'

/** Stand in for the API: answer every request to it, and collect the ones the page sent (not the browser's preflights). */
async function answer(page: Page, respond: (request: Request) => { status: number; type?: string; body?: string }): Promise<Request[]> {
  const sent: Request[] = []
  await page.route(`${API}/**`, async (route) => {
    const request = route.request()
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*, authorization',
      'access-control-allow-methods': '*',
    }
    // Before a request with a body or a token, a browser asks the API whether it may send it.
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    sent.push(request)
    const { status, type, body } = respond(request)
    await route.fulfill({ status, headers: { ...cors, ...(type ? { 'content-type': type } : {}) }, body: body ?? '' })
  })
  return sent
}

test.describe('trying a request', () => {
  test('the form opens from the request line, and is not fetched before that', async ({ page }) => {
    const scripts: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(request.url())
    })
    await open(page, `${BUILT}/api/ping`)
    const toggle = page.getByRole('button', { name: 'Try it' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.sb-api-try')).toHaveCount(0)
    const before = scripts.length

    await toggle.click()
    await expect(page.locator('.sb-api-try')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true')
    // The form is a file of its own, which a reader who only reads never fetches.
    expect(scripts.length).toBeGreaterThan(before)
    // The address comes from the page. This request takes no body, so there is no field for one.
    await expect(page.getByLabel('Address')).toHaveValue(API)
    await expect(page.getByLabel('Body')).toHaveCount(0)

    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('.sb-api-try')).toBeHidden()
  })

  test('sends what the page describes, with what the reader filled in, and shows the answer', async ({ page }) => {
    const sent = await answer(page, () => ({ status: 200, type: 'application/json', body: '{"pong":true,"region":"eu west"}' }))
    await open(page, `${BUILT}/api/ping`)
    await page.getByRole('button', { name: 'Try it' }).click()
    const form = page.locator('.sb-api-try')

    // A parameter of the path has to be given: nothing is sent without it.
    await form.getByRole('button', { name: 'Send GET' }).click()
    expect(sent).toHaveLength(0)

    await form.getByLabel('region').fill('eu west')
    await form.getByLabel('Query').fill('verbose=1')
    await form.getByLabel('Headers').fill('X-Trace: abc')
    await form.getByRole('button', { name: 'Send GET' }).click()

    const status = form.getByRole('status')
    await expect(status).toContainText('200')
    await expect(status.locator('strong')).toHaveAttribute('data-ok', '')
    // JSON is laid out to be read, whatever way it came.
    await expect(form.getByRole('region', { name: 'Answer' })).toHaveText('{\n  "pong": true,\n  "region": "eu west"\n}')

    expect(sent).toHaveLength(1)
    expect(sent[0]!.method()).toBe('GET')
    // The value is encoded, so it stays one segment of the path.
    expect(sent[0]!.url()).toBe(`${API}/v1/ping/eu%20west?verbose=1`)
    expect(sent[0]!.headers()['x-trace']).toBe('abc')
    expect(sent[0]!.postData()).toBeNull()
  })

  test('a request with a body starts from the one the page gives, and sends it as JSON', async ({ page }) => {
    const sent = await answer(page, () => ({ status: 201, type: 'application/json; charset=utf-8', body: '{"id":7}' }))
    await open(page, `${BUILT}/api/create`)
    await page.getByRole('button', { name: 'Try it' }).click()
    const form = page.locator('.sb-api-try')

    const body = form.getByLabel('Body')
    await expect(body).toHaveValue('{\n  "text": "Hello",\n  "pinned": false\n}')
    await form.getByLabel('region').fill('eu')
    await form.getByLabel('Headers').fill('Authorization: Bearer abc')

    // A body that is not JSON is not sent: the reader is told what is wrong with it.
    await body.fill('{"text": ')
    await form.getByRole('button', { name: 'Send POST' }).click()
    await expect(form.getByRole('status')).toContainText('The body is not JSON')
    expect(sent).toHaveLength(0)

    await body.fill('{"text": "Hi"}')
    await form.getByRole('button', { name: 'Send POST' }).click()
    await expect(form.getByRole('status')).toContainText('201')
    await expect(form.getByRole('region', { name: 'Answer' })).toHaveText('{\n  "id": 7\n}')

    expect(sent).toHaveLength(1)
    expect(sent[0]!.method()).toBe('POST')
    // `:region` is a parameter like `{region}`.
    expect(sent[0]!.url()).toBe(`${API}/v1/regions/eu/notes`)
    expect(sent[0]!.headers()['authorization']).toBe('Bearer abc')
    expect(sent[0]!.headers()['content-type']).toBe('application/json')
    expect(sent[0]!.postDataJSON()).toEqual({ text: 'Hi' })
  })

  test('an answer that is an error is shown as one, and a request that gets no answer says why it may be', async ({ page }) => {
    let reachable = true
    await page.route(`${API}/**`, (route) =>
      reachable
        ? route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }, body: 'No such region.' })
        : route.abort(),
    )
    await open(page, `${BUILT}/api/ping`)
    await page.getByRole('button', { name: 'Try it' }).click()
    const form = page.locator('.sb-api-try')
    await form.getByLabel('region').fill('nowhere')

    await form.getByRole('button', { name: 'Send GET' }).click()
    const status = form.getByRole('status')
    await expect(status).toContainText('404')
    await expect(status.locator('strong')).not.toHaveAttribute('data-ok')
    await expect(form.getByRole('region', { name: 'Answer' })).toHaveText('No such region.')

    reachable = false
    await form.getByRole('button', { name: 'Send GET' }).click()
    await expect(status).toContainText('The request got no answer')
    // The answer to the request before is not left on the page under the new message.
    await expect(form.getByRole('region', { name: 'Answer' })).toHaveCount(0)
  })

  test('the address and the headers are kept from one page of an API to the next, and nowhere else', async ({ page }) => {
    await open(page, `${BUILT}/api/ping`)
    await page.getByRole('button', { name: 'Try it' }).click()
    await page.getByLabel('Headers').fill('Authorization: Bearer abc')
    await page.getByLabel('region').fill('eu')

    // To the other page of the same API, without loading a new document.
    await page.locator('.sb-region-sidebar').getByRole('link', { name: 'Create a note' }).click()
    await expect(page).toHaveURL(`${BUILT}/api/create`)
    await page.getByRole('button', { name: 'Try it' }).click()
    await expect(page.getByLabel('Headers')).toHaveValue('Authorization: Bearer abc')
    // What belonged to the other request did not come along.
    await expect(page.getByLabel('region')).toHaveValue('')

    // It was never written to the browser's storage, so a reload forgets it.
    expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toContain('Bearer')
    await page.reload()
    await page.getByRole('button', { name: 'Try it' }).click()
    await expect(page.getByLabel('Headers')).toHaveValue('')
  })
})
