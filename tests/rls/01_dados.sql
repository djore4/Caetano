insert into auth.users(email) values ('admin@x.pt'),('chefe@x.pt'),('vend@x.pt'),('crm@x.pt');   -- crm@x.pt: conta de OUTRA app, sem perfil
insert into public.utilizadores(id,nome,email,perfil,local) values
 (1,'Admin','admin@x.pt','Administrador','["Todas"]'),
 (2,'Chefe','chefe@x.pt','Chefe de Vendas','["Porto"]'),
 (3,'Vendedor','vend@x.pt','Vendedor','["Gaia"]');
insert into public.viaturas(chassis,modelo,local,inputs) values
 ('CH1','X1','["Porto"]','{"pvb":40000,"mgb":0.05}'),('CH2','iX','["Gaia"]','{"pvb":70000,"mgb":0.04}');
insert into public.viaturas_vendidas(chassis,modelo,preco_final) values ('CH9','X3',48500);
insert into public.historico(tabela,acao,registo_id) values ('viaturas','CRIAR','CH1');
