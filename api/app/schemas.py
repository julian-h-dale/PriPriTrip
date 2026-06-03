from typing import List, Literal, Optional

from pydantic import BaseModel


class LocationModel(BaseModel):
    name: str
    lat: Optional[float] = None
    long: Optional[float] = None
    fullAddress: Optional[str] = None
    description: Optional[str] = None
    link: Optional[str] = None


class TripHeader(BaseModel):
    tripId: str
    tripName: str
    startDate: str
    endDate: str


class TripItemCreate(BaseModel):
    itemId: str
    parentItemId: Optional[str] = None
    kind: Literal["group", "leg"]
    title: str
    startDateTime: str
    endDateTime: str
    sortOrder: int
    confirmationNumber: Optional[str] = None
    type: Optional[Literal["travel", "stay", "activity"]] = None
    subtype: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: List[LocationModel] = []
    completed: bool = False
    completedDateTime: Optional[str] = None


class TripItemUpdate(BaseModel):
    parentItemId: Optional[str] = None
    kind: Literal["group", "leg"]
    title: str
    startDateTime: str
    endDateTime: str
    sortOrder: int
    confirmationNumber: Optional[str] = None
    type: Optional[Literal["travel", "stay", "activity"]] = None
    subtype: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: List[LocationModel] = []
    completed: bool = False
    completedDateTime: Optional[str] = None


class TripItemPatch(BaseModel):
    parentItemId: Optional[str] = None
    kind: Optional[Literal["group", "leg"]] = None
    title: Optional[str] = None
    startDateTime: Optional[str] = None
    endDateTime: Optional[str] = None
    sortOrder: Optional[int] = None
    confirmationNumber: Optional[str] = None
    type: Optional[Literal["travel", "stay", "activity"]] = None
    subtype: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: Optional[List[LocationModel]] = None
    completed: Optional[bool] = None
    completedDateTime: Optional[str] = None


class TripItemResponse(BaseModel):
    itemId: str
    tripId: str
    parentItemId: Optional[str] = None
    kind: Literal["group", "leg"]
    title: str
    startDateTime: str
    endDateTime: str
    sortOrder: int
    confirmationNumber: Optional[str] = None
    type: Optional[Literal["travel", "stay", "activity"]] = None
    subtype: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    logoUrl: Optional[str] = None
    locations: List[LocationModel] = []
    completed: bool = False
    completedDateTime: Optional[str] = None
    deletedAt: Optional[str] = None
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class TripResponse(BaseModel):
    tripId: str
    tripName: str
    startDate: str
    endDate: str
    items: List[TripItemResponse] = []


class AuthRequest(BaseModel):
    password: str


class AuthResponse(BaseModel):
    token: str
    mapsApiKey: str
