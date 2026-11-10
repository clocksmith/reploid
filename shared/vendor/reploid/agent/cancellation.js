// The abort race lives at the library root so transport may use it; adapters/doppler.js still imports this path.
export { abortable } from '../cancellation.js';
