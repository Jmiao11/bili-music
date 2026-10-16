let renderPresentation: (() => void) | undefined;
function installPresentationRender(render: () => void): void { renderPresentation = render; }
function refreshPresentation(): void { renderPresentation?.(); }
export { installPresentationRender, refreshPresentation };
