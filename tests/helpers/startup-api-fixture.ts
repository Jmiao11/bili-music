import type vm from "node:vm";

function wireMiniHostApi(context: vm.Context, library: { getState(): { library: unknown } }) {
  const app = context.getApplicationStore();
  context.getApplicationStore = () => ({ ...app, getState: () => ({ ...app.getState(), library: library.getState().library }) });
}
export { wireMiniHostApi };
