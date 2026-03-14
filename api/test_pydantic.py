from pydantic import BaseModel, ConfigDict, Field


class MockORM:
    def __init__(self):
        self.metadata_ = {"key": "value"}
        self.metadata = "SQLAlchemy MetaData"


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    metadata: dict = Field(validation_alias="metadata_")


class Schema2(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    metadata_: dict = Field(serialization_alias="metadata")


obj = MockORM()
s1 = Schema.model_validate(obj)
print("Schema1 dict:", s1.model_dump())
print("Schema1 json:", s1.model_dump_json())

s2 = Schema2.model_validate(obj)
print("Schema2 dict:", s2.model_dump(by_alias=True))
print("Schema2 json:", s2.model_dump_json(by_alias=True))
