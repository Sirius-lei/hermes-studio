import Router from '@koa/router'
import * as ctrl from '../../controllers/DiTing/performance-monitor'
import { requireSuperAdmin } from '../../middleware/user-auth'

export const performanceMonitorRoutes = new Router()

performanceMonitorRoutes.get('/api/DiTing/performance/runtime', requireSuperAdmin, ctrl.runtime)
