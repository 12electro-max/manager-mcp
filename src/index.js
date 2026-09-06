export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        status: "online",
        service: "Manager AI Bridge"
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};
