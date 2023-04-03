import fs from 'node:fs';
import { createElement } from 'react';
import { createRouter } from '@hattip/router';
import { crossStreams } from './streams.js';
import * as ReactServerDom from 'react-server-dom-webpack/server.browser';
import * as ReactClient from 'react-server-dom-webpack/client.browser';
import * as ReactServer from 'react-dom/server.browser';

import { readClientComponentMap, resolveClientDist, resolveServerDist } from './utils.js';

const server = createRouter();

server.get('/rsc', async ({ request }) => {
	const { searchParams } = new URL(request.url);
	const PageModule = await import(
		resolveServerDist(
			`page.js${
				// Invalidate cached module on every request in dev mode
				// WARNING: can cause memory leaks for long-running dev servers!
				process.env.NODE_ENV === 'development' ? `?invalidate=${Date.now()}` : ''
			}`
		).href
	);

	// Render the Page component and send the query params as props.
	const Page = createElement(PageModule.default, Object.fromEntries(searchParams));

	// The `clientComponentMap` is generated by the build step.
	// This is run on server startup and on `app/` file changes.
	// @see './build.js'
	const clientComponentMap = await readClientComponentMap();

	globalThis.__webpack_require__ = (id) => {
		return import('..' + id);
	};

	// 👀 This is where the magic happens!
	// Render the server component tree to a stream.
	// This renders your server components in real time and
	// sends each component to the browser as soon as its resolved.
	const flightStream = ReactServerDom.renderToReadableStream(Page, clientComponentMap);

	// split the stream into two streams using "tee"
	// one for the html and one for the data
	const [htmlDataStream, rscDataStream] = flightStream.tee();

	const rscComponent = await ReactClient.createFromReadableStream(
		htmlDataStream,
		clientComponentMap
	);

	const htmlStream = await ReactServer.renderToReadableStream(rscComponent, {});

	const stream = crossStreams(rscDataStream, htmlStream);

	return new Response(stream, {
		// "Content-type" based on https://github.com/facebook/react/blob/main/fixtures/flight/server/global.js#L159
		headers: { 'Content-type': 'text/html' }
	});
});

// Serve HTML homepage that fetches and renders the server component.
server.get('/', async () => {
	const html = await fs.promises.readFile(
		new URL('./templates/index.html', import.meta.url),
		'utf-8'
	);
	return new Response(html, {
		headers: { 'Content-type': 'text/html' }
	});
});

// Serve client-side components in `dist/client/`.
server.get('/dist/client/**/*.js', async ({ request }) => {
	const { pathname } = new URL(request.url);
	const filePath = pathname.replace('/dist/client/', '');
	const contents = await fs.promises.readFile(resolveClientDist(filePath), 'utf-8');
	return new Response(contents, {
		headers: {
			'Content-Type': 'application/javascript'
		}
	});
});

export const handler = server.buildHandler();
