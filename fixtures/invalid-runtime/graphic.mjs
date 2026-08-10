/**
 * Deliberately incomplete OGraf implementation. The manifest is statically
 * valid, but the automatic runtime test must report the missing API methods.
 */
export default class InvalidRuntimeGraphic extends HTMLElement {
    async load() {
        return { statusCode: 200 };
    }
}
