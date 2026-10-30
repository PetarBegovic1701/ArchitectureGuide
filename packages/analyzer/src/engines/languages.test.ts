import { describe, expect, it } from 'vitest';
import {
  parseDotnetProject,
  parsePipfile,
  parsePyproject,
  parseRequirements,
  parseSetupCfg,
  parseSetupPy,
  parseToml,
} from './manifests';
import { indexPython } from './py-index';
import { indexCSharp } from './cs-index';

describe('Python manifests', () => {
  it('reads requirement names, without versions, extras, markers and options', () => {
    expect(
      parseRequirements(
        '# web\nFastAPI[all]>=0.110 ; python_version > "3.10"\n-r base.txt\n-e .\nDjango_REST.framework==3.15  # api\nshop-common @ file:../libs/common\n',
      ),
    ).toEqual(['fastapi', 'django-rest-framework', 'shop-common']);
  });

  it('reads PEP 621, Poetry and uv dependency groups from pyproject.toml', () => {
    const m = parsePyproject(`
[project]
name = "orders"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",  # web
  'SQLAlchemy[asyncio]~=2.0',
]
[project.optional-dependencies]
dev = ["pytest"]
[project.scripts]
orders = "app.cli:main"
[tool.poetry.group.test.dependencies]
httpx = "^0.27"
python = "^3.12"
[dependency-groups]
lint = ["ruff>=0.6"]
`);
    expect(m).toEqual({
      name: 'orders',
      deps: ['fastapi', 'sqlalchemy', 'pytest', 'ruff', 'httpx'],
      scripts: { orders: 'app.cli:main' },
      pythonVersion: '>=3.12',
    });
  });

  it('reads setup.py, setup.cfg and Pipfile', () => {
    expect(
      parseSetupPy('setup(name="billing", install_requires=["flask>=3", "celery"])'),
    ).toMatchObject({
      name: 'billing',
      deps: ['flask', 'celery'],
    });
    expect(
      parseSetupCfg(
        '[metadata]\nname = billing\n\n[options]\ninstall_requires =\n    flask>=3\n    rq\n',
      ),
    ).toMatchObject({ name: 'billing', deps: ['flask', 'rq'] });
    expect(parsePipfile('[packages]\nDjango = "*"\n\n[dev-packages]\npytest = "*"\n').deps).toEqual(
      ['django', 'pytest'],
    );
  });

  it('reads inline tables and dotted keys in TOML', () => {
    expect(
      parseToml('[tool.uv.sources]\nshop = { path = "../libs/shop", editable = true }\na.b = 1\n'),
    ).toMatchObject({
      'tool.uv.sources': { shop: { path: '../libs/shop', editable: true } },
      'tool.uv.sources.a': { b: 1 },
    });
  });
});

describe('.NET project files', () => {
  it('reads the SDK, target framework, packages and resolved project references', () => {
    const p = parseDotnetProject(
      'src/Orders.Api/Orders.Api.csproj',
      `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup><TargetFrameworks>net8.0;net9.0</TargetFrameworks><OutputType>Exe</OutputType></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8.0.4" />
    <ProjectReference Include="..\\Orders.Domain\\Orders.Domain.csproj" />
  </ItemGroup>
</Project>`,
    );
    expect(p).toEqual({
      name: 'Orders.Api',
      sdk: 'Microsoft.NET.Sdk.Web',
      language: 'csharp',
      outputType: 'Exe',
      targetFramework: 'net8.0',
      packages: ['Npgsql.EntityFrameworkCore.PostgreSQL'],
      projectRefs: ['src/Orders.Domain/Orders.Domain.csproj'],
      functions: false,
    });
    expect(
      parseDotnetProject('Lib/Lib.fsproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>').language,
    ).toBe('fsharp');
  });
});

describe('Python source index', () => {
  const index = indexPython(`
import os
from fastapi import APIRouter
from .models import Order as O

router = APIRouter(prefix="/orders")

@router.post(
    "/",
    status_code=201,
)
async def create(body: NewOrder):
    """Docstring with ( a parenthesis"""
    url = os.environ["CATALOG_URL"]  # comment (
    session.add(O(id=1))

class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    note: Mapped[str]

    class Meta:
        db_table = "shop_orders"

    def total(self):
        x = 1
`);

  it('reads imports, multi-line decorators and module assignments', () => {
    expect(index.imports.map((i) => [i.module, i.names, i.level])).toEqual([
      ['os', [], 0],
      ['fastapi', ['APIRouter'], 0],
      ['models', ['O'], 1],
    ]);
    expect(index.decorators).toMatchObject([
      { callee: 'router.post', line: 8, target: 'create', targetKind: 'function' },
    ]);
    expect(index.decorators[0]!.args).toContain('"/"');
    expect(index.assigns).toMatchObject([{ name: 'router', value: 'APIRouter(prefix="/orders")' }]);
    expect(index.env).toEqual([{ name: 'CATALOG_URL', line: 14 }]);
    expect(index.calls.map((c) => c.callee)).toContain('session.add');
  });

  it('keeps class fields and Meta options, not the locals of methods', () => {
    expect(index.classes).toHaveLength(1);
    const cls = index.classes[0]!;
    expect(cls.fields.map((f) => f.name)).toEqual(['__tablename__', 'id', 'note']);
    expect(cls.meta).toEqual({ db_table: '"shop_orders"' });
  });
});

describe('C# source index', () => {
  const index = indexCSharp(`using Microsoft.AspNetCore.Mvc;
namespace Orders.Api;

// [HttpDelete] in a comment is not an attribute
[ApiController]
[Route("api/[controller]")]
public sealed class OrdersController(OrdersDb db) : ControllerBase
{
    [HttpGet("{id:int}")]
    public Task<Order?> Get(int id) => db.Orders.FindAsync(id).AsTask();

    [HttpPost, Authorize]
    public async Task<IActionResult> Create(NewOrder o)
    {
        db.Orders.Add(new Order());
        var url = Environment.GetEnvironmentVariable("CATALOG_URL");
        return Ok(builder.Configuration.GetConnectionString("Orders"));
    }
}

public class OrdersDb : DbContext
{
    public DbSet<Order> Orders => Set<Order>();
}
`);

  it('reads classes with attributes, bases, attributed methods and DbSets', () => {
    const [controller, db] = index.classes;
    expect(controller).toMatchObject({
      name: 'OrdersController',
      bases: ['ControllerBase'],
      attributes: [
        { name: 'ApiController', args: '' },
        { name: 'Route', args: '"api/[controller]"' },
      ],
    });
    expect(controller!.methods.map((m) => [m.name, m.attributes.map((a) => a.name)])).toEqual([
      ['Get', ['HttpGet']],
      ['Create', ['HttpPost', 'Authorize']],
    ]);
    expect(db!.dbSets).toEqual([{ entity: 'Order', name: 'Orders', line: 23 }]);
  });

  it('reads calls and configuration keys by kind', () => {
    expect(index.calls.find((c) => c.callee === 'db.Orders.Add')?.line).toBe(15);
    expect(index.config).toEqual([
      { key: 'Orders', line: 17, kind: 'connection-string' },
      { key: 'CATALOG_URL', line: 16, kind: 'env' },
    ]);
  });
});
