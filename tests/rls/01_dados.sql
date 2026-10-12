insert into auth.users(email) values ('admin@x.pt'),('chefe@x.pt'),('vend@x.pt'),('crm@x.pt');   -- crm@x.pt: conta de OUTRA app, sem perfil
insert into public.utilizadores(id,nome,email,perfil,local,negocio,marca) values
 (1,'Admin','admin@x.pt','Administrador','["Todas"]','["VD","VU"]','["BMW","BMW Motorrad"]'),
 (2,'Chefe','chefe@x.pt','Chefe de Vendas','["Porto"]','["VD","VU"]','["BMW","BMW Motorrad"]'),
 (3,'Vendedor','vend@x.pt','Vendedor','["Gaia"]','["VD","VU"]','["BMW","BMW Motorrad"]'),
 -- perfis com camada tipo/marca restrita
 (4,'So VD BMW','vd@x.pt','Vendedor','["Porto"]','["VD"]','["BMW"]'),
 (5,'Chefe VU','vu@x.pt','Chefe de Vendas','["Porto"]','["VU"]','["BMW","BMW Motorrad"]'),
 (6,'Sem camada','nulo@x.pt','Vendedor','["Porto"]',null,null),
 (7,'Todas','todas@x.pt','Vendedor','["Porto"]','["Todas"]','["Todas"]'),
 (8,'Chefe VD','chefevd@x.pt','Chefe de Vendas','["Porto"]','["VD"]','["BMW"]');
insert into public.viaturas(chassis,modelo,local,estado_negocio,marca,inputs) values
 ('CH1','X1','["Porto"]','VD','["BMW"]','{"pvb":40000,"mgb":0.05}'),
 ('CH2','iX','["Gaia"]','VU','["BMW"]','{"pvb":70000,"mgb":0.04}'),
 ('CH3','R1300','["Porto"]','VD','["BMW Motorrad"]','{"pvb":20000}');
insert into public.viaturas_vendidas(chassis,modelo,preco_final,estado_negocio,marca) values ('CH9','X3',48500,'VD','["BMW"]');
insert into public.historico(tabela,acao,registo_id) values ('viaturas','CRIAR','CH1');
