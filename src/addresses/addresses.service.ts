import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '@/common/errors';
import { GOVERNORATES } from '@/common/governorates';
import { normalizeEgyptPhone } from '@/common/utils/text';
import { Address, AddressDocument } from './address.schema';
import { CreateAddressDto, UpdateAddressDto } from './addresses.dto';

const MAX_ADDRESSES = 10;

@Injectable()
export class AddressesService {
  constructor(@InjectModel(Address.name) private readonly addresses: Model<Address>) {}

  async list(userId: string) {
    const rows = await this.addresses
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ isDefault: -1, createdAt: -1 });
    return rows.map(toView);
  }

  async create(userId: string, dto: CreateAddressDto) {
    const uid = new Types.ObjectId(userId);
    const count = await this.addresses.countDocuments({ userId: uid });
    if (count >= MAX_ADDRESSES) throw AppError.unprocessable('ADDRESS_LIMIT', `Up to ${MAX_ADDRESSES} addresses allowed`);
    const isDefault = dto.isDefault || count === 0;
    if (isDefault) await this.addresses.updateMany({ userId: uid }, { $set: { isDefault: false } });
    const doc = await this.addresses.create({ ...this.normalize(dto), userId: uid, isDefault });
    return toView(doc);
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    const doc = await this.getOwned(userId, id);
    if (dto.isDefault) {
      await this.addresses.updateMany({ userId: doc.userId, _id: { $ne: doc._id } }, { $set: { isDefault: false } });
    }
    Object.assign(doc, this.normalize(dto));
    await doc.save();
    return toView(doc);
  }

  async remove(userId: string, id: string) {
    const doc = await this.getOwned(userId, id);
    await doc.deleteOne();
    if (doc.isDefault) {
      await this.addresses
        .findOneAndUpdate({ userId: doc.userId }, { $set: { isDefault: true } }, { sort: { createdAt: -1 } });
    }
  }

  async getOwned(userId: string, id: string): Promise<AddressDocument> {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound('Address');
    const doc = await this.addresses.findOne({ _id: id, userId: new Types.ObjectId(userId) });
    if (!doc) throw AppError.notFound('Address');
    return doc;
  }

  private normalize(dto: UpdateAddressDto) {
    const { location, phone, ...rest } = dto;
    const out: Partial<Address> = { ...rest };
    if (phone !== undefined) {
      const normalized = normalizeEgyptPhone(phone);
      if (!normalized) {
        throw AppError.unprocessable('INVALID_PHONE', 'Enter a valid Egyptian mobile number', [
          { field: 'phone', reason: 'invalid_egypt_mobile' },
        ]);
      }
      out.phone = normalized;
    }
    if (location) out.location = { type: 'Point', coordinates: [location.lng, location.lat] };
    return out;
  }
}

export function toView(a: AddressDocument | (Address & { _id: Types.ObjectId })) {
  const gov = GOVERNORATES.find((g) => g.code === a.governorate);
  return {
    id: a._id.toString(),
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    governorate: a.governorate,
    governorateName: gov?.ar ?? a.governorate,
    city: a.city,
    area: a.area,
    street: a.street,
    building: a.building,
    floor: a.floor,
    apartment: a.apartment,
    landmark: a.landmark,
    location: a.location ? { lat: a.location.coordinates[1], lng: a.location.coordinates[0] } : null,
    isDefault: a.isDefault,
  };
}
