import { expect, it, vi } from 'vitest';
vi.mock('@/server/auth/session',()=>({getServerSession:vi.fn(async()=>null),requestContext:{run:(_request:Request,callback:()=>unknown)=>callback()}}));
vi.mock('@/server/auth/handler',()=>({authHandler:vi.fn(async()=>undefined)}));
import { matchRoute, dispatch } from '@/server/http';
import { getServerSession } from '@/server/auth/session';
it('matches dynamic API parameters and rejects encoded path separators',()=>{
 expect(matchRoute('/api/databases/connection/schema/catalog/table')?.params).toEqual({id:'connection',db:'catalog',table:'table'});
 expect(matchRoute('/api/vms/vm/services/test-port')?.params).toEqual({id:'vm'});
 expect(matchRoute('/api/vms/a%2Fb')).toBeNull();expect(matchRoute('/api/vms/%zz')).toBeNull();expect(matchRoute('/api/nonexistent')).toBeNull();
});
it('returns JSON 401 for unauthenticated API calls and 405 for unsupported methods',async()=>{
 const rejected=await dispatch(new Request('http://localhost/api/vms'),'fixture');expect(rejected.status).toBe(401);expect(await rejected.json()).toEqual({error:'Unauthorized'});
 vi.mocked(getServerSession).mockResolvedValue({user:{id:'fixture',name:'fixture'},expires:'2099-01-01',authVersion:0});
 const method=await dispatch(new Request('http://localhost/api/vms',{method:'PATCH'}),'fixture');expect(method.status).toBe(405);expect(method.headers.get('allow')).toContain('GET');
 expect((await dispatch(new Request('http://localhost/api/nonexistent'),'fixture')).status).toBe(404);
});
