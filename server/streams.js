/**
 * Given a stream of HTML and a stream of RSC data, return a stream
 * that interleaves the two streams, wrapping each chunk of RSC data
 * in a script tag.
 *
 * @param {ReadableStream} dataStream
 * @param {ReadableStream} htmlStream
 * @returns {ReadableStream}
 */
export function crossStreams(dataStream, htmlStream) {
	const textDecoder = new TextDecoder('utf-8');

	// a transformstream that wraps each chunk in a script tag
	const scriptTagger = new TransformStream({
		transform(chunk, controller) {
			const text = textDecoder.decode(chunk);
			controller.enqueue(`<script>${text}</script>`);
		}
	});

	// wrap the data stream in a script tag
	// and interleave it with the html stream
	const scriptStream = dataStream.pipeThrough(scriptTagger);

	const interleavedStream = new ReadableStream({
		async start(controller) {
			const htmlReader = htmlStream.getReader();
			const scriptReader = scriptStream.getReader();

			const readStream = async (reader) => {
				while (true) {
					const { value, done } = await reader.read();
					if (done) {
						break;
					}
					controller.enqueue(value);
				}
			};

			try {
				await Promise.all([readStream(htmlReader), readStream(scriptReader)]);
			} catch (error) {
				controller.error(error);
				return;
			} finally {
				htmlReader.releaseLock();
				scriptReader.releaseLock();
			}

			controller.close();
		}
	});
	return interleavedStream;
}
