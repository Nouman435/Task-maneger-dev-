import { getStore } from "@netlify/blobs";
import "bcryptjs";
import "jsonwebtoken";
import "zod";
import api from "../api-handler.cjs";

export default async function handler(request) {
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD"
    ? null
    : await request.text();
  const event = {
    path: url.pathname,
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body
  };
  const response = await api.createHandler(getStore("daymark-data"))(event);
  return new Response(response.statusCode === 204 ? null : response.body, {
    status: response.statusCode,
    headers: response.headers
  });
}
