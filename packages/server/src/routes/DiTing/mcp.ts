import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/mcp'

export const mcpRoutes = new Router()

mcpRoutes.get('/api/DiTing/mcp/servers', ctrl.listServers)
mcpRoutes.post('/api/DiTing/mcp/servers', ctrl.addServer)
mcpRoutes.patch('/api/DiTing/mcp/servers/:name', ctrl.updateServer)
mcpRoutes.delete('/api/DiTing/mcp/servers/:name', ctrl.removeServer)
mcpRoutes.post('/api/DiTing/mcp/servers/:name/test', ctrl.testServer)
mcpRoutes.get('/api/DiTing/mcp/tools', ctrl.listTools)
mcpRoutes.post('/api/DiTing/mcp/reload', ctrl.reloadMcp)
